import { connect } from 'puppeteer-core';
import { download_pdf } from './download_pdf.js';
import { unlink } from 'node:fs';

unlink('search4_sale_doc.png', (err) => null)

const SBR_WS_ENDPOINT = `wss://${process.env.BRIGHTDATA_AUTH}@brd.superproxy.io:9222`;

const url = "https://iapps.courts.state.ny.us/nyscef/CaseSearch"

const browser = await connect({
    browserWSEndpoint: SBR_WS_ENDPOINT,
});

console.log('Connected! Navigating...');
const page = await browser.newPage();

await page.goto(url, { waitUntil: 'networkidle2' });
console.log('Navigated! Searching for case...');

const index_number = '705281/2016'
await page.locator('#txtCaseIdentifierNumber').fill(index_number);
page.keyboard.press('Enter')

await page.waitForNavigation({ waitUntil: 'networkidle2' });

console.log('Navigated! Clicking first case result...');
await page.locator('#form > table.NewSearchResults > tbody > tr > td:nth-child(1) > a').click()

await page.waitForNavigation({ waitUntil: 'networkidle2' });

console.log('Navigated! Selecting last page...');
const link = await page.locator('a.pageOff').filter(a => a.innerText === ' Last')
await page.screenshot({
    path: 'search4_sale_doc.png',
});
console.log(link)
await link.click()
await page.locator('#showProgress').wait();
// this didn't work
// await page.select('select#selDocumentType', 'NOTICE OF SALE')
// page.keyboard.press('Enter');




// await page.waitForNavigation({ waitUntil: 'networkidle2' });
// await page.waitForNetworkIdle()


const downloadUrl = await page.evaluate(() => {
    const links = document.evaluate(`//a[text()="NOTICE OF SALE"]`, document,
        null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
    if (links.snapshotLength > 0) {
        return links.snapshotItem(links.snapshotLength - 1).href;
    }
    return null;
});


if (!downloadUrl) {
    console.warn('Did not find link to download!');
    await browser.disconnect();
    process.exit(1);
}

const filename = await download_pdf(downloadUrl, null, index_number.replace('/', '-') + ".pdf")
  
console.log(`Downloaded. ${filename}`);



browser.disconnect()
