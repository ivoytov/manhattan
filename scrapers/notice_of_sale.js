import { connect } from 'puppeteer-core';
import { download_pdf } from './download_pdf.js';

const SBR_WS_ENDPOINT = 'ws://127.0.0.1:9222/devtools/browser/e0f7c846-beef-45cb-8125-625c68082024' //`wss://${process.env.BRIGHTDATA_AUTH}@brd.superproxy.io:9222`;
const url = "https://iapps.courts.state.ny.us/nyscef/CaseSearch"


const county_map = {
    "Manhattan": "31",
    "Queens": "41",
    "Bronx": "62",
    "Brooklyn": "24",
    "Staten Island": "43",
}

 const FilingType = Object.freeze({
    NOTICE_OF_SALE: {id: "1163", path: "noticeofsale"},
    JUDGEMENT: {id: "1310", path: "judgement"},
})



if (import.meta.url === `file://${process.argv[1]}`) {
    download_filing(process.argv[2], process.argv[3]).catch(err => {
        console.error(err.stack || err);
        process.exit(1);
    });
}


export async function download_filing(index_number, county, filing = FilingType.NOTICE_OF_SALE, endpoint = SBR_WS_ENDPOINT) {
    const browser = await connect({
        browserWSEndpoint: endpoint,
    });

    console.log('Connected! Navigating...');
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: 'networkidle2' });
    console.log('Navigated! Searching for case...');

    await page.locator('#txtCaseIdentifierNumber').fill(index_number);
    await page.locator('select#txtCounty').fill(county_map[county]);

    page.keyboard.press('Enter');

    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    console.log('Navigated! Clicking first case result...');
    await page.locator('#form > table.NewSearchResults > tbody > tr > td > a').click();

    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    console.log('Navigated! Selecting document type...');
    const availableFilings = await page.$$eval("select#selDocumentType > option", options => {
        return options.map(el => el.value)
    })
    if (!availableFilings.includes(filing.id)) {
        console.warn(`No filing of requested type ${filing.id} exists`, index_number, county);
        await browser.disconnect();
        return null
    }

    await page.locator('select#selDocumentType').fill(filing.id);
    await page.click('input[name="btnNarrow"]'); // To submit the form
    await page.waitForNetworkIdle();

    const downloadUrl = await page.$eval("#form > div.tabBody > table > tbody > tr > td:last-child > a", el => el.href)
    console.log("downloadUrl", downloadUrl)
    if (!downloadUrl) {
        console.warn('Did not find link to download!', index_number, county);
        await browser.disconnect();
        return null
    }

    const filename = await download_pdf(downloadUrl, "saledocs/" + filing.path + '/' + index_number.replace('/', '-') + ".pdf");

    console.log(`Downloaded. ${filename}`);
    browser.disconnect();
    return filename
}
