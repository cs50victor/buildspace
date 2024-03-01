use async_openai::{config::OpenAIConfig, types::CreateEmbeddingRequestArgs};
use deepgram::{
    transcription::prerecorded::{
        audio_source::AudioSource,
        options::{Language, Options, Tier},
    },
    Deepgram,
};
use futures::StreamExt;
use headless_chrome::Browser;
use rustube::{Id, Video};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    env,
    fs::{self, File},
    io::{BufWriter, Read, Write},
    time::{Duration, Instant},
};

#[derive(Clone, Debug, Serialize, Deserialize, Default)]
struct DemoDaySubmission {
    title: String,
    description: String,
    niche: String,
    youtube_url: String,
    youtube_transcript: Option<String>,
    embedding: Option<Vec<f32>>,
    social: String,
}

// submission with working youtube links
const NUM_OF_VALID_S3_SUBMISSIONS: usize = 404;

#[tokio::main(flavor = "multi_thread")]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().expect(".env file not found");

    let deepgram_api_key =
        env::var("DEEPGRAM_API_KEY").expect("DEEPGRAM_API_KEY environmental variable");

    let paths = fs::read_dir("./seasons")?;
    let browser = Browser::default()?;
    let req_timeout = Duration::from_secs(120);

    let http_client = &reqwest::Client::builder().timeout(req_timeout).build()?;
    
    let dg_client = &Deepgram::new(&deepgram_api_key);
    let openai_client = &async_openai::Client::new();

    for file_path in paths.flatten() {
        let file_path = file_path.path();

        let full_path = fs::canonicalize(&file_path)?;
        let path = format!("file://{}", full_path.to_str().unwrap());

        if !path.ends_with("html") {
            continue;
        }

        println!("reading {path}");
        let start = Instant::now();

        let tab = browser.new_tab()?;
        tab.set_default_timeout(std::time::Duration::from_millis(5));

        tab.navigate_to(&path)?;

        if tab.wait_for_element("body").is_err() {
            println!("body tag not found in html");
            return Ok(());
        };

        println!("body found in html");
        let re = regex::Regex::new(
            r"(?:\/embed\/|\/v\/|\/watch\?v=|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]+)",
        )?;

        let file = File::open("seasons/s3_raw.json")?;
        let mut s3_raw_submission: Vec<DemoDaySubmission> =
            serde_json::from_reader(file).expect("JSON was not well-formatted");

        let s3_raw_submission_hash: HashMap<_, _> = s3_raw_submission
            .iter()
            .map(|s| (s.title.clone(), s.youtube_url.clone()))
            .collect();

        let num_of_s3_submissions_from_cache = s3_raw_submission.len();

        println!(
            "using {} submissions from s3.html cache",
            num_of_s3_submissions_from_cache
        );

        if num_of_s3_submissions_from_cache == NUM_OF_VALID_S3_SUBMISSIONS {
            println!("all s3 submission successfully retrieved from cache");
        } else if let Ok(submissions) = tab.wait_for_elements("div.framer-1wkjeqj-container") {
            println!("...processing {} buildspace submisions", submissions.len());
            
            let submissions = submissions
                .iter()
                .filter_map(|c| {
                    let title = c
                        .wait_for_element("div.framer-1i5kbww>p")
                        .map(|el| el.get_inner_text().unwrap_or_default())
                        .unwrap_or_default();
                    if s3_raw_submission_hash.contains_key(&title) {
                        return None;
                    };
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

                    let youtube_url = re.find(submission_dom).map_or("".to_string(), |s|regex_output_to_yt_url(s.as_str()));

                    println!("\t url {youtube_url}");
                    Some(DemoDaySubmission {
                        title,
                        description,
                        niche,
                        social,
                        youtube_url,
                        youtube_transcript: None,
                        embedding: None,
                    })
                })
                .filter(|s| !s.youtube_url.is_empty())
                .collect::<Vec<DemoDaySubmission>>();

            s3_raw_submission.extend(submissions);
            let file = File::create("seasons/s3_raw.json")?;
            let mut writer = BufWriter::new(file);
            serde_json::to_writer(&mut writer, &s3_raw_submission)?;
            let elapsed = start.elapsed();
            writer.flush()?;
            println!(
                "total time taken to process file : {:.4}ms",
                elapsed.as_secs()
            );
        };

        let file = File::open("seasons/s3.json")?;
        let mut s3_embedded_submissions: Vec<DemoDaySubmission> =
            serde_json::from_reader(file).unwrap_or_default();

        let num_of_s3_embedded_submissions_from_cache = s3_embedded_submissions.len();
        println!(
            "using embedded {} submissions from s3.html cache",
            num_of_s3_embedded_submissions_from_cache
        );

        if num_of_s3_embedded_submissions_from_cache == NUM_OF_VALID_S3_SUBMISSIONS {
            println!("all embedded s3 submission successfully retrieved from cache");
            return Ok(());
        };
        
        let mut s3_embedded_submissions_hash: HashMap<_, _> = s3_embedded_submissions
            .iter()
            .map(|s| (s.title.clone(), s.youtube_url.clone()))
            .collect();

        while s3_embedded_submissions.len() != NUM_OF_VALID_S3_SUBMISSIONS {
            for embedded_submission_chunk in s3_raw_submission.chunks(40){
                let fetches = futures::stream::iter(embedded_submission_chunk.iter().cloned().map(|mut s| {
                    async {
                        if s3_embedded_submissions_hash.contains_key(&s.title){return None}
    
                        let Ok((audio_url, mime)) = youtube_video_audio_url(&s.youtube_url).await else {return None};

                        let transcript = match audio_url_to_text(&audio_url, mime.clone(), dg_client, http_client).await{
                            Ok(t) => t,
                            Err(e) => {
                                // println!("{e:?}");
                                return None;
                            },
                        };
        
                        let Ok(video_embedding) = text_to_embedding(&transcript, openai_client).await else {return None};
                        s.youtube_transcript = Some(transcript);
                        s.embedding = Some(video_embedding);
                        Some(s)
                    }
                }))
                .buffer_unordered(10)
                .collect::<Vec<_>>();
        
                println!("Waiting...");
        
                let submissions_with_embeddings = fetches.await;
                let submissions_with_embeddings = submissions_with_embeddings
                    .into_iter()
                    .flatten()
                    .collect::<Vec<_>>();
        
                let submissions_with_embeddings_hash: HashMap<_, _> = s3_embedded_submissions
                    .iter()
                    .map(|s| (s.title.clone(), s.youtube_url.clone()))
                    .collect();
    
                s3_embedded_submissions.extend(submissions_with_embeddings);
                s3_embedded_submissions_hash.extend(submissions_with_embeddings_hash);
                println!("writing {} submissions_with_embeddings", s3_embedded_submissions.len());
                let file = File::create("seasons/s3.json")?;
                let mut writer = BufWriter::new(file);
                serde_json::to_writer(&mut writer, &s3_embedded_submissions)?;
                writer.flush()?;
            };
        }
        let elapsed = start.elapsed();
        println!(
            "total time taken to process file : {:.4}ms",
            elapsed.as_secs()
        );
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
    http_client: &reqwest::Client,
) -> anyhow::Result<String> {
    let resp = http_client.get(audio_url).send().await?;
    println!("downloading audio to memory");
    // TODO; figure out why this constantly errors out
    let body_bytes_stream = resp.bytes_stream();

    let source = AudioSource::from_buffer_with_mime_type(reqwest::Body::wrap_stream(body_bytes_stream), audio_mime);

    // Adds Read and Seek to the bytes via Cursor
    let options = Options::builder()
        .punctuate(true)
        .tier(Tier::Enhanced)
        .language(Language::en_US)
        .build();

    let response = deepgram_client
    .transcription()
    .prerecorded(source, &options)
    .await?;
    println!("transcribing audio with deepgram");

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


// implement later - https://blog.0x7d0.dev/history/how-they-bypass-youtube-video-download-throttling/
// video_url:
// video_transcript:
// video_embedding:
// context:
// social:
