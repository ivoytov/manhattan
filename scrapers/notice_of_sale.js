import { connect } from 'puppeteer-core';
import { download_pdf } from './download_pdf.js';


// const SBR_WS_ENDPOINT = `wss://${process.env.BRIGHTDATA_AUTH}@brd.superproxy.io:9222`;
const SBR_WS_ENDPOINT = `ws://127.0.0.1:9222/devtools/browser/e474b55b-88c5-4e84-a301-0da1a8e586d8`
const url = "https://iapps.courts.state.ny.us/nyscef/CaseSearch"


if (import.meta.url === `file://${process.argv[1]}`) {
    download_notice_of_sale(process.argv[2]).catch(err => {
        console.error(err.stack || err);
        process.exit(1);
    });
}

export async function download_notice_of_sale(index_number) {
    const browser = await connect({
        browserWSEndpoint: SBR_WS_ENDPOINT,
    });

    console.log('Connected! Navigating...');
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: 'networkidle2' });
    console.log('Navigated! Searching for case...');

    await page.locator('#txtCaseIdentifierNumber').fill(index_number);
    page.keyboard.press('Enter');

    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    console.log('Navigated! Clicking first case result...');
    await page.locator('#form > table.NewSearchResults > tbody > tr > td:nth-child(1) > a').click();

    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    console.log('Navigated! Selecting document type...');
    await page.select('select#selDocumentType', '1163');
    await page.click('input[name="btnNarrow"]'); // To submit the form
    await page.waitForNetworkIdle();

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
        return null
    }

    const filename = await download_pdf(downloadUrl, "saledocs/" + index_number.replace('/', '-') + ".pdf");

    console.log(`Downloaded. ${filename}`);
    page.close();
    browser.disconnect();
    return filename
}
