#!/usr/bin/env node
const puppeteer = require('puppeteer-core');
const fs = require('fs/promises');
const SBR_WS_ENDPOINT = `wss://${process.env.BRIGHTDATA_AUTH}@brd.superproxy.io:9222`;

async function main() {
    console.log('Connecting to Scraping Browser...');
    const url = process.argv[2];
    console.log(`You passed: ${url}`);
    const browser = await puppeteer.connect({
        browserWSEndpoint: SBR_WS_ENDPOINT,
    });

    // Extract the file name from the URL
    const fileName = url.split('/').pop();
    console.log(`Saving as: ${fileName}`);

    const file = await fs.open(fileName, 'w');

    try {
        console.log('Connected! Navigating to pdf...');
        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(3 * 60 * 1000); // Increase timeout

        const client = await page.createCDPSession();
        await client.send('Fetch.enable', {
            patterns: [{
                requestStage: 'Response',
                resourceType: 'Document',
            }],
        });

        const r = await new Promise((resolve, reject) => {
            let resolved;
            client.on('Fetch.requestPaused', ({ requestId }) => {
                if (resolved) {
                    client.send('Fetch.continueRequest', { requestId });
                } else {
                    resolved = true;
                    resolve(requestId);
                }
            });
            page.goto(url).catch(e => {
                if (resolved) {
                    console.log(e);
                }
                reject(e);
            });
        });

        console.log('Saving pdf stream to file...');
        const { stream: s } = await client.send('Fetch.takeResponseBodyAsStream', { requestId: r });

        while (true) {
            const { data, base64Encoded, eof } = await client.send('IO.read', { handle: s });
            const chunk = Buffer.from(data, base64Encoded ? 'base64' : 'utf8');
            await file.write(chunk);
            console.log('Got chunk', { c: chunk.length, eof: !!eof });
            if (eof) break;
        }
        await client.send('IO.close', { handle: s });
        await client.send('Fetch.fulfillRequest', {
            requestId: r,
            responseCode: 200,
            body: ''
        });
        console.log('Done');
    } catch (e) {
        console.error("Error during PDF processing:", e);
    } finally {
        await file.close();
        await browser.close();
    }
}

if (require.main === module) {
    main().catch(err => {
        console.error(err.stack || err);
        process.exit(1);
    });
}