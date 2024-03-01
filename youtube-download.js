import axios from 'axios';
import vm from 'vm';
import fs from 'fs';
import child_process from 'child_process';

const videoId = 'aqz-KE-bpKQ';

/**
 * From the Youtube API, retrieve metadata about the video (title, video format and audio format)
 */
async function retrieveMetadata(videoId) {
  const response = await axios.post('https://www.youtube.com/youtubei/v1/player', {
    videoId: videoId,
    context: {
      client: { clientName: 'WEB', clientVersion: '2.20230810.05.00' },
    },
  });

  const formats = response.data.streamingData.adaptiveFormats;

  return [
    response.data.videoDetails.title,
    formats.filter((w) => w.mimeType.startsWith('video/webm'))[0],
    formats.filter((w) => w.mimeType.startsWith('audio/webm'))[0],
  ];
}

/**
 * From the Youtube Web Page, retrieve the challenge algorithm for the n query parameter
 */
async function retrieveChallenge(video_id) {
  /**
   * Find the URL of the javascript file for the current player version
   */
  async function retrieve_player_url(video_id) {
    let response = await axios.get('https://www.youtube.com/embed/' + video_id);
    let player_hash = /\/s\/player\/(\w+)\/player_ias.vflset\/\w+\/base.js/.exec(response.data)[1];
    return `https://www.youtube.com/s/player/${player_hash}/player_ias.vflset/en_US/base.js`;
  }

  const player_url = await retrieve_player_url(video_id);

  const response = await axios.get(player_url);
  let challenge_name = /\.get\("n"\)\)&&\(b=([a-zA-Z0-9$]+)(?:\[(\d+)\])?\([a-zA-Z0-9]\)/.exec(
    response.data,
  )[1];
  challenge_name = new RegExp(`var ${challenge_name}\\s*=\\s*\\[(.+?)\\]\\s*[,;]`).exec(
    response.data,
  )[1];

  const challenge = new RegExp(
    `${challenge_name}\\s*=\\s*function\\s*\\(([\\w$]+)\\)\\s*{(.+?}\\s*return\\ [\\w$]+.join\\(""\\))};`,
    's',
  ).exec(response.data)[2];

  return challenge;
}

/**
 * Solve the challenge and replace the n query parameter from the url
 */
function solveChallenge(challenge, formatUrl) {
  const url = new URL(formatUrl);

  const n = url.searchParams.get('n');
  const n_transformed = vm.runInNewContext(`((a) => {${challenge}})('${n}')`);

  url.searchParams.set('n', n_transformed);
  return url.toString();
}

/**
 * Download a media file by breaking it into several 10MB segments
 */
async function download(url, length, file) {
  const MEGABYTE = 1024 * 1024;

  await fs.promises.rm(file, { force: true });

  let downloadedBytes = 0;

  while (downloadedBytes < length) {
    let nextSegment = downloadedBytes + 10 * MEGABYTE;
    if (nextSegment > length) nextSegment = length;

    // Download segment
    const start = Date.now();
    let response = await axios.get(url, {
      headers: { Range: `bytes=${downloadedBytes}-${nextSegment}` },
      responseType: 'stream',
    });

    // Write segment
    await fs.promises.writeFile(file, response.data, { flag: 'a' });
    const end = Date.now();

    // Print download stats
    const progress = ((nextSegment / length) * 100).toFixed(2);
    const total = (length / MEGABYTE).toFixed(2);
    const speed = ((((nextSegment - downloadedBytes) / (end - start)) * 1000) / MEGABYTE).toFixed(
      2,
    );
    console.log(`${progress}% of ${total}MB at ${speed}MB/s`);

    downloadedBytes = nextSegment + 1;
  }
}

/**
 * Using ffmpeg, combien the audio and video file into one
 */
async function combineChannels(destinationFile, videoFile, audioFile) {
  await fs.promises.rm(destinationFile, { force: true });
  child_process.spawnSync('ffmpeg', [
    '-y',
    '-i',
    videoFile,
    '-i',
    audioFile,
    '-c',
    'copy',
    '-map',
    '0:v:0',
    '-map',
    '1:a:0',
    destinationFile,
  ]);

  await fs.promises.rm(videoFile, { force: true });
  await fs.promises.rm(audioFile, { force: true });
}

console.log();
console.log('Retrieving metadata');
const [title, video, audio] = await retrieveMetadata(videoId);
const challenge = await retrieveChallenge(videoId);

console.log();
console.log('Solving challenge');
video.url = solveChallenge(challenge, video.url);
audio.url = solveChallenge(challenge, audio.url);

console.log();
console.log('Downloading video');
await download(video.url, video.contentLength, 'video.webm');

console.log();
console.log('Downloading audio');
await download(audio.url, audio.contentLength, 'audio.webm');

console.log('Combining video and audio');
await combineChannels(title + '.webm', 'video.webm', 'audio.webm');
