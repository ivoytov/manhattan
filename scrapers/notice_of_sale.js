import { connect } from 'puppeteer-core';
import { download_pdf } from './download_pdf.js';
import path from 'path';
import { existsSync, appendFile } from 'fs';


const SBR_WS_ENDPOINT = `wss://${process.env.BRIGHTDATA_AUTH}@brd.superproxy.io:9222`;
const url = "https://iapps.courts.state.ny.us/nyscef/CaseSearch"


const county_map = {
    "Manhattan": "31",
    "Queens": "41",
    "Bronx": "62",
    "Brooklyn": "24",
    "Staten Island": "43",
}

export const FilingType = Object.freeze({
    // JUDGEMENT: { id: "1310", dir: "judgement" },
    NOTICE_OF_SALE: { id: "1163", dir: "noticeofsale" },
    SURPLUS_MONEY_FORM: { id: "1741", dir: "surplusmoney" }
})

function missing_filings(index_number) {
    const out = []
    for (const f in FilingType) {
        const { dir } = FilingType[f]

        const filename = index_number.replace('/', '-') + ".pdf"
        const pdfPath = path.resolve(`saledocs/${dir}/${filename}`);
        if (!existsSync(pdfPath)) {
            out.push(FilingType[f])
        }
    }
    return out
}


export async function download_filing(index_number, county, auction_date = null, endpoint = SBR_WS_ENDPOINT,) {
    const filename = index_number.replace('/', '-') + ".pdf"
    let missingFilings = missing_filings(index_number)

    if (auction_date && (new Date(auction_date) > new Date())) {
        // if auction date in the future, only get the notice of sale, otherwise get the surplus money form too
        missingFilings = missingFilings.filter(filing => filing != FilingType.SURPLUS_MONEY_FORM)
    }

    if (!missingFilings.length) return

    const browser = await connect({
        browserWSEndpoint: endpoint,
    });

    // console.log('Connected! Navigating...');
    const page = await browser.newPage();

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 2*60*1000 });

    await page.locator('#txtCaseIdentifierNumber').fill(index_number);
    await page.locator('select#txtCounty').fill(county_map[county]);

    page.keyboard.press('Enter');

    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    try {
        await page.locator('#form > table.NewSearchResults > tbody > tr > td > a').click();
    } catch (e) {
        console.warn(`\n\n${index_number} couldn't find a valid case with this index`)
        return
    }


    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // console.log('Navigated! Selecting document type...');
    const availableFilings = await page.$$eval("select#selDocumentType > option", options => {
        return options.map(el => el.value)
    })
    // check for motion to discontinue
    if (availableFilings.includes("3664")) {
        appendFile("foreclosures/cases.log", `${index_number} Discontinued\n`, (err) => {
            if (err) {
              console.error('Failed to append to the file:', err);
            } else {
                console.log(`Case ${index_number} Motion to Discontinue detected`)
            }
          });
        return
    }
    let res;
    for (const { dir, id } of missingFilings) {
        
        const pdfPath = path.resolve(`saledocs/${dir}/${filename}`);
        if (!existsSync(pdfPath) && availableFilings.includes(id)) {
            // console.log(`Trying to get filing ${id}`)

            await page.locator('select#selDocumentType').fill(id);
            await page.click('input[name="btnNarrow"]'); // To submit the form
            await page.waitForNetworkIdle();

          
            let downloadUrl
            try {
                downloadUrl = await page.$eval("#form > div.tabBody > table > tbody > tr:last-child > td:nth-child(2) > a", el => el.href)
            } catch (e) {
                console.warn(`\n\n${index_number} ${dir} couldn't find a valid download link.`)
                return
            }
            
            res = await download_pdf(downloadUrl, pdfPath);            

            await page.click("input[name='btnClear']")
            await page.waitForNetworkIdle();
        }
    }

    // finish up
    await page.close()
    browser.disconnect();
    return res

}

if (import.meta.url === `file://${process.argv[1]}`) {
    const endpoint = process.argv.includes('--browser') ? process.argv[process.argv.indexOf('--browser') + 1] : SBR_WS_ENDPOINT;

    download_filing(process.argv[2], process.argv[3], process.argv[4], endpoint).catch(err => {
        console.error(err.stack || err);
        process.exitCode = 1;
    }).then(() => { process.exitCode = 0 });
}

