use std::{fs, path::PathBuf};

use headless_chrome::{protocol::cdp::Page, Browser};
use scraper::Html;

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

        if !path.ends_with("s3.html"){
            continue;
        }

        let tab = browser.new_tab()?;

        tab.navigate_to(&path)?;

        tab.wait_for_element("button[aria-label=\"Play\"]")?.click()?;

        let jpeg_data = tab.capture_screenshot(
            Page::CaptureScreenshotFormatOption::Jpeg,
            Some(75),
            None,
            true)?;
    
        std::fs::write("hello_world.jpeg", jpeg_data)?;
        // let document = Html::parse_document(&html);

    }
    Ok(())
}

// video_url:
// video_transcript:
// video_embedding:
// context:
// social: