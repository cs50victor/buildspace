use async_openai::{config::OpenAIConfig, types::CreateEmbeddingRequestArgs};
use deepgram::{
    transcription::prerecorded::{
        audio_source::AudioSource,
        options::{Language, Options},
    },
    Deepgram,
};
use headless_chrome::Browser;
use rustube::{Id, Video};
use serde::Serialize;
use std::{env, fs::{self, File}, io::{BufWriter, Write}};

#[derive(Debug, Serialize)]
struct DemoDaySubmission {
    title: String,
    description: String,
    niche: String,
    youtube_url: String,
    youtube_transcript: Option<String>,
    embedding: Option<Vec<f32>>,
    social: String,
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let deepgram_api_key =
        env::var("DEEPGRAM_API_KEY").expect("DEEPGRAM_API_KEY environmental variable");

    let paths = fs::read_dir("./seasons")?;
    let browser = Browser::default()?;

    for file_path in paths.flatten() {
        let file_path = file_path.path();

        let full_path = fs::canonicalize(&file_path)?;
        let path = format!("file://{}", full_path.to_str().unwrap());

        if !path.ends_with("html") || !path.ends_with("s3.html") {
            continue;
        }

        println!("reading {path}");

        let tab = browser.new_tab()?;
        tab.set_default_timeout(std::time::Duration::from_secs(5));

        tab.navigate_to(&path)?;
        if tab.wait_for_element("body").is_ok() {
            println!("body found");
            let re = regex::Regex::new(
                r"(?:\/embed\/|\/v\/|\/watch\?v=|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]+)",
            )?;
            if let Ok(submissions) = tab.find_elements("div.framer-1wkjeqj-container") {
                println!("...processing {} buildspace submisions", submissions.len());
                let mut submissions = submissions
                    .iter()
                    .map(|c| {
                        let title = c
                            .wait_for_element("div.framer-1i5kbww>p")
                            .map(|el| el.get_inner_text().unwrap_or_default())
                            .unwrap_or_default();

                        println!("saving title {}", title);

                        let description = c
                            .wait_for_element("div.framer-1mn76q2>p")
                            .map(|el| el.get_inner_text().unwrap_or_default())
                            .unwrap_or_default();

                        let niche = c
                            .wait_for_element("div.framer-bxilt0>p")
                            .map(|el| el.get_inner_text().unwrap_or_default())
                            .unwrap_or_default();

                        let social = c
                            .wait_for_element("a.framer-1jrlt0f.framer-10sms40")
                            .map(|el| {
                                el.get_attribute_value("href")
                                    .unwrap_or_default()
                                    .unwrap_or_default()
                            })
                            .unwrap_or_default();

                        if let Ok(x) = c.wait_for_element("button[aria-label=\"Play\"]") {
                            let _ = x.click();
                        };

                        let submission_dom = &c.get_content().unwrap_or_default();

                        let youtube_url = match re.find(submission_dom) {
                            Some(s) => regex_output_to_yt_url(s.as_str()),
                            None => "".to_string(),
                        };

                        DemoDaySubmission {
                            title,
                            description,
                            niche,
                            social,
                            youtube_url,
                            youtube_transcript: None,
                            embedding: None,
                        }
                    })
                    .filter(|s| !s.youtube_url.is_empty())
                    .collect::<Vec<DemoDaySubmission>>();

                // fs::write("/season/s3.json",submission).expect("Unable to write file");
                println!("x {submissions:?}");

                let reqwest_client = &reqwest::Client::new();
                let dg_client = &Deepgram::new(&deepgram_api_key);
                let openai_client = &async_openai::Client::new();

                for s in submissions.iter_mut() {
                    let Ok((audio_url, mime)) = youtube_video_audio_url(&s.youtube_url).await
                    else {
                        continue;
                    };
                    let Ok(transcript) =
                        audio_url_to_text(&audio_url, mime, dg_client, reqwest_client).await
                    else {
                        // try again
                        continue;
                    };
                    let Ok(video_embedding) = text_to_embedding(&transcript, openai_client).await
                    else {
                        continue;
                    };
                    s.youtube_transcript = Some(transcript);
                    s.embedding = Some(video_embedding);
                }

                let file = File::create("s3.json")?;
                let mut writer = BufWriter::new(file);
                serde_json::to_writer(&mut writer, &submissions)?;
                writer.flush()?;
                // let json = serde_json::to_string(&submissions)?;
            };
        };
    }

    Ok(())
}

fn regex_output_to_yt_url(re_match: &str) -> String {
    let id = re_match.split('/').last().unwrap();
    format!("https://youtube.com/watch?v={}", id)
}

async fn audio_url_to_text(
    audio_url: &str,
    audio_mime: String,
    deepgram_client: &Deepgram,
    reqwest_client: &reqwest::Client,
) -> anyhow::Result<String> {
    let resp = reqwest_client.get(audio_url).send().await?;
    println!("downloading audio to memory");
    let x = resp.bytes().await.unwrap();
    println!("saved audio to memory");

    let source = AudioSource::from_buffer_with_mime_type(x, audio_mime);

    // Adds Read and Seek to the bytes via Cursor
    let options = Options::builder()
        .punctuate(true)
        .language(Language::en_US)
        .build();

    println!("transcribing audio with deepgram");
    let response = deepgram_client
        .transcription()
        .prerecorded(source, &options)
        .await?;

    println!("transcription complete");
    Ok(response.results.channels[0].alternatives[0]
        .transcript
        .clone()
        .to_owned())
}

async fn youtube_video_audio_url(video_url: &str) -> anyhow::Result<(String, String)> {
    let id = Id::from_raw(video_url)?;
    let video = Video::from_id(id.into_owned()).await?;
    let best_audio = video
        .streams()
        .iter()
        .filter(|stream| stream.includes_audio_track && !stream.includes_video_track)
        .max_by_key(|stream| stream.quality_label);

    let best_audio = best_audio.unwrap();
    Ok((
        best_audio.signature_cipher.url.to_string(),
        best_audio.mime.to_string(),
    ))
}

async fn text_to_embedding(
    text: &str,
    open_ai_client: &async_openai::Client<OpenAIConfig>,
) -> anyhow::Result<Vec<f32>> {
    let request = CreateEmbeddingRequestArgs::default()
        .model("text-embedding-3-small")
        .input(text)
        .build()?;

    let response = open_ai_client.embeddings().create(request).await?;

    let data = &response.data[0];
    assert_eq!(data.embedding.len(), 1536);
    Ok(data.embedding.clone())
}

// video_url:
// video_transcript:
// video_embedding:
// context:
// social:
