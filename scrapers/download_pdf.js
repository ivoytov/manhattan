#!/usr/bin/env node
import { connect } from 'puppeteer-core';
import { open } from 'fs/promises'

const SBR_WS_ENDPOINT = `wss://${process.env.BRIGHTDATA_AUTH}@brd.superproxy.io:9222`;
const endpoint = process.env.WSS ?? SBR_WS_ENDPOINT;

export async function download_pdf(url, fileName = null) { 
    console.log(`In download_pdf with url: ${url} ${fileName.split('/').pop()}`); 

    const browser = await connect({ 
        browserWSEndpoint: endpoint, 
    }); 
    
    let file

    try { 
        // console.log('Connected! Navigating to pdf...'); 
        const page = await browser.newPage(); 
        page.setDefaultNavigationTimeout(3 * 60 * 1000); 

        const client = await page.createCDPSession(); 
        await client.send('Fetch.enable', { 
            patterns: [{ 
                requestStage: 'Response', 
                resourceType: 'Document', 
            }], 
        }); 

        const requestId = await new Promise((resolve, reject) => { 
            let resolved; 
            client.on('Fetch.requestPaused', async ({ requestId, responseHeaders }) => { 
                const contentTypeHeader = responseHeaders.find(header => header.name.toLowerCase() === 'content-type');
                if (contentTypeHeader && contentTypeHeader.value.includes('text/html')) {
                    reject(new Error('HTML response received instead of PDF'));
                } else {
                    if (resolved) { 
                        client.send('Fetch.continueRequest', { requestId }); 
                    } else { 
                        resolved = true; 
                        resolve(requestId); 
                    } 
                }

                const contentDisposition = responseHeaders.find(header => header.name.toLowerCase() === 'content-disposition');
                const matchFilename = contentDisposition["value"].match(/filename="(.*)"/);
                if (matchFilename) {
                    fileName = fileName ?? matchFilename[1];
                }
            }); 
            page.goto(url, {timeout: 2*60*1000}).catch(e => { 
                if (!resolved) { 
                    reject(e); 
                } 
            }); 
        }); 
        fileName = fileName ?? "test.pdf"
        file = await open(fileName, 'w'); 

        // console.log('Saving pdf stream to file...'); 
        const { stream } = await client.send('Fetch.takeResponseBodyAsStream', { requestId }); 

        let totalBytes = 0; 
        while (true) { 
            const { data, base64Encoded, eof } = await client.send('IO.read', { handle: stream }); 
            const chunk = Buffer.from(data, base64Encoded ? 'base64' : 'utf8'); 
            await file.write(chunk); 
            totalBytes += chunk.length; 
            // console.log(`Got chunk: ${chunk.length} bytes, Total: ${totalBytes} bytes, EOF: ${eof}`); 
            if (eof) break; 
        } 
        await client.send('IO.close', { handle: stream }); 
        await client.send('Fetch.fulfillRequest', { 
            requestId: requestId, 
            responseCode: 200, 
            body: '' 
        }); 

        if (totalBytes < 1000) { 
            throw new Error("PDF content seems too small, might be corrupted."); 
        } 

        // console.log('PDF downloaded successfully'); 
        await page.close()
        return fileName; 
    } catch (e) { 
        console.error("Error during PDF processing:", e); 
        throw e; 
    } finally { 
        if (file) {
            await file.close(); 
        }
        await browser.disconnect(); 
    } 
} 

if (import.meta.url === `file://${process.argv[1]}`) {
    download_pdf(process.argv[2]).catch(err => {
        console.error(err.stack || err);
        process.exit(1);
    });
}
