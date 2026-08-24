import { EdgeTTS } from 'node-edge-tts';
import fs from 'fs';
import path from 'path';

async function test() {
  try {
    const tts = new EdgeTTS({
      voice: 'id-ID-GadisNeural',
      lang: 'id-ID',
      outputFormat: 'audio-24khz-48kbitrate-mono-mp3'
    });
    
    // Test if we can save it to a file
    const p = path.resolve('test-output.mp3');
    await tts.ttsPromise('Halo kakak, ini percobaan suara natural Edge TTS!', p);
    
    console.log("Success! File saved at:", p);
    
    // Check if file exists and has size
    if (fs.existsSync(p)) {
      const stats = fs.statSync(p);
      console.log(`File size: ${stats.size} bytes`);
    } else {
      console.log("File was not created.");
    }
  } catch (err) {
    console.error("Error during TTS generation:", err);
  }
}

test();
