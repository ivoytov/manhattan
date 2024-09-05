import { connect } from 'puppeteer-core';
import { download_pdf } from './download_pdf.js';


const SBR_WS_ENDPOINT = `wss://${process.env.BRIGHTDATA_AUTH}@brd.superproxy.io:9222`;
const url = "https://iapps.courts.state.ny.us/nyscef/CaseSearch"


if (import.meta.url === `file://${process.argv[1]}`) {
    download_notice_of_sale(process.argv[2], process.argv[3]).catch(err => {
        console.error(err.stack || err);
        process.exit(1);
    });
}

const county_map = {
    "Manhattan": "31",
    "Queens": "41",
    "Bronx": "62",
    "Brooklyn": "24",
    "Staten Island": "43",
}

export async function download_notice_of_sale(index_number, county) {
    const browser = await connect({
        browserWSEndpoint: SBR_WS_ENDPOINT,
    });

    console.log('Connected! Navigating...');
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: 'networkidle2' });
    console.log('Navigated! Searching for case...');

    await page.locator('#txtCaseIdentifierNumber').fill(index_number);
    await page.select('select#txtCounty', county_map[county]);

    page.keyboard.press('Enter');

    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    console.log('Navigated! Clicking first case result...');
    await page.locator('#form > table.NewSearchResults > tbody > tr > td > a').click();

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
        console.warn('Did not find link to download!', index_number, county);
        await browser.disconnect();
        return null
    }

    const filename = await download_pdf(downloadUrl, "saledocs/" + index_number.replace('/', '-') + ".pdf");

    console.log(`Downloaded. ${filename}`);
    browser.disconnect();
    return filename
}
