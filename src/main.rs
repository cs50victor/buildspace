use std::{fs, path::PathBuf, time::Duration};

use headless_chrome::{protocol::cdp::Page, Browser};
use scraper::Html;

#[derive(Debug)]
struct Submission {
    title: String,
    description: String,
    niche: String,
    youtube_url: String,
    social: String,
}

fn main() -> anyhow::Result<()> {
    let paths = fs::read_dir("./seasons")?;
    let browser = Browser::default()?;

    for file_path in paths.flatten() {
        let file_path = file_path.path();
        let _raw_html =
            fs::read_to_string(&file_path).expect("Should have been able to read the file");

        let full_path = fs::canonicalize(&file_path)?;
        let path = format!("file://{}", full_path.to_str().unwrap());
        println!("reading {path}");

        if !path.ends_with("s3.html") {
            continue;
        }

        let tab = browser.new_tab()?;
        tab.set_default_timeout(std::time::Duration::from_secs(5));

        tab.navigate_to(&path)?;
        if tab.wait_for_element("body").is_ok() {
            let re = regex::Regex::new(
                r"(?:\/embed\/|\/v\/|\/watch\?v=|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]+)",
            )?;
            if let Ok(submissions) = tab.find_elements("div.framer-1wkjeqj-container") {
                println!("...processing {} buildspace submisions", submissions.len());
                for (i, c) in submissions.into_iter().enumerate() {
                    println!("{i})");

                    if let Ok(x) = c.wait_for_element("button[aria-label=\"Play\"]") {
                        x.click()?;
                    };

                    let submission_dom = &c.get_content().unwrap();

                    let youtube_url =
                        regex_output_to_yt_url(re.find(submission_dom).unwrap().as_str());

                    // if let Ok(x) = c.wait_for_element("div.framer-1i5kbww>p") {
                    //     println!("title {:?}", x.get_inner_text().unwrap());
                    // };
                    let title = c
                        .wait_for_element("div.framer-1i5kbww>p")
                        .map(|el| el.get_inner_text().unwrap())?;

                    let description = c
                        .wait_for_element("div.framer-1mn76q2>p")
                        .map(|el| el.get_inner_text().unwrap())?;

                    let niche = c
                        .wait_for_element("div.framer-bxilt0>p")
                        .map(|el| el.get_inner_text().unwrap())?;

                    let social = c
                        .wait_for_element("a.framer-1jrlt0f.framer-10sms40")
                        .map(|el| el.get_attribute_value("href").unwrap().unwrap())?;

                    let submission = Submission {
                        title,
                        description,
                        niche,
                        social,
                        youtube_url,
                    };

                    println!("submission - {:?}", submission);
                }
            };
        };
    }
    Ok(())
}

fn regex_output_to_yt_url(re_match: &str) -> String {
    let id = re_match.split('/').last().unwrap();
    format!("https://youtube.com/watch?v={}", id)
}

// video_url:
// video_transcript:
// video_embedding:
// context:
// social:
