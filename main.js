import { Actor } from 'apify';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

Actor.main(async () => {
    const input = await Actor.getInput();

    const {
        url,
        startSec,
        endSec,
        clipName = 'clip',
    } = input;

    // --- Validate input ---
    if (!url) throw new Error('Missing required input: url');
    if (startSec === undefined || startSec === null) throw new Error('Missing required input: startSec');
    if (endSec === undefined || endSec === null) throw new Error('Missing required input: endSec');
    if (endSec <= startSec) throw new Error('endSec must be greater than startSec');

    const duration = endSec - startSec;
    const safeClipName = clipName.replace(/[^a-zA-Z0-9_\-]/g, '_');
    const outputFile = `/tmp/${safeClipName}.mp4`;

    console.log(`Downloading clip: ${url}`);
    console.log(`Segment: ${startSec}s → ${endSec}s (${duration}s)`);

    // --- Install yt-dlp if not present ---
    try {
        execSync('which yt-dlp', { stdio: 'ignore' });
        console.log('yt-dlp already installed.');
    } catch {
        console.log('Installing yt-dlp...');
        execSync('pip install yt-dlp --quiet', { stdio: 'inherit' });
    }

    // --- Download only the clip segment using yt-dlp + ffmpeg postprocessor ---
    // --download-sections downloads only the specified time range (server-side)
    // No full video is downloaded
    const ytDlpCmd = [
        'yt-dlp',
        `"${url}"`,
        `--download-sections "*${startSec}-${endSec}"`,
        '--force-keyframes-at-cuts',         // accurate cuts
        '-f "bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]/best"',
        '--merge-output-format mp4',
        `--output "${outputFile}"`,
        '--no-playlist',
        '--quiet',
        '--progress',
    ].join(' ');

    console.log('Running yt-dlp...');
    try {
        await execAsync(ytDlpCmd, { timeout: 300000 }); // 5 min timeout
    } catch (err) {
        throw new Error(`yt-dlp failed: ${err.stderr || err.message}`);
    }

    // --- Verify output file exists ---
    if (!fs.existsSync(outputFile)) {
        // yt-dlp sometimes appends a suffix — scan /tmp for the file
        const tmpFiles = fs.readdirSync('/tmp').filter(f => f.startsWith(safeClipName) && f.endsWith('.mp4'));
        if (tmpFiles.length === 0) throw new Error('Output file not found after yt-dlp run.');
        // use first match
        const found = path.join('/tmp', tmpFiles[0]);
        fs.renameSync(found, outputFile);
    }

    const fileSizeBytes = fs.statSync(outputFile).size;
    console.log(`Clip downloaded. Size: ${(fileSizeBytes / 1024 / 1024).toFixed(2)} MB`);

    // --- Upload to Apify Key-Value Store ---
    const kvStore = await Actor.openKeyValueStore();
    const recordKey = `${safeClipName}.mp4`;

    await kvStore.setValue(recordKey, fs.readFileSync(outputFile), {
        contentType: 'video/mp4',
    });

    const storeId = kvStore.id;
    const clipUrl = `https://api.apify.com/v2/key-value-stores/${storeId}/records/${recordKey}`;

    console.log(`Clip uploaded. URL: ${clipUrl}`);

    // --- Push to dataset (for n8n to read) ---
    await Actor.pushData({
        clipUrl,
        clipName: safeClipName,
        storeId,
        recordKey,
        startSec,
        endSec,
        duration,
        fileSizeBytes,
        sourceUrl: url,
    });

    // --- Cleanup ---
    fs.unlinkSync(outputFile);

    console.log('Done.');
});
