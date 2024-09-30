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

    // for auctions in the last 5 days, don't look for a surpplus money form
    const earliestDayForMoneyForm = new Date()
    earliestDayForMoneyForm.setDate(earliestDayForMoneyForm.getDate() - 5)

    // for aucitons more than 21 days in the future, don't look for a notice of sale
    const latestDayForNoticeOfSale = new Date()
    latestDayForNoticeOfSale.setDate(latestDayForNoticeOfSale.getDate() + 21)

    if (auction_date && (auction_date > earliestDayForMoneyForm)) {
        // if auction date in the future, only get the notice of sale, otherwise get the surplus money form too
        missingFilings = missingFilings.filter(filing => filing != FilingType.SURPLUS_MONEY_FORM)
    }
    if (auction_date && auction_date > latestDayForNoticeOfSale) {
        // if auction date too far in the future, don't look for a notice of sale
        missingFilings = missingFilings.filter(filing => filing != FilingType.NOTICE_OF_SALE)
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
    for (const filing of missingFilings) {
        const { dir, id } = filing
        const pdfPath = path.resolve(`saledocs/${dir}/${filename}`);
        if (!existsSync(pdfPath) && availableFilings.includes(id)) {
            // console.log(`Trying to get filing ${id}`)

            await page.locator('select#selDocumentType').fill(id);
            await page.click('input[name="btnNarrow"]'); // To submit the form
            await page.waitForNetworkIdle();

          
            let downloadUrl
            try {
                const receivedDate = await page.$eval("#form > div.tabBody > table > tbody > tr:last-child > td:nth-child(3) > span", el => new Date(el.innerText.split(" ")[2]))

                // if received date is before auction date, this is not the right surplus money form
                if (auction_date && filing == FilingType.SURPLUS_MONEY_FORM && receivedDate < auction_date) {
                    console.warn(`Found SMF with received date ${receivedDate.toISOString().split('T')[0]}, before auction date ${auction_date.toISOString().split('T')[0]}; SKIPPING`)
                    continue
                }  else {
                    console.warn(`Found SMF with received date ${receivedDate.toISOString().split('T')[0]}, after auction date ${auction_date.toISOString().split('T')[0]}; PROCEEDING`)
                }

                // if received date is >90 days before the auction date, this is not the right notice of sale form
                const earliestDayForNoticeOfSale = auction_date
                earliestDayForNoticeOfSale.setDate(earliestDayForNoticeOfSale.getDate() - 90)
                if (auction_date && filing == FilingType.NOTICE_OF_SALE && (receivedDate < earliestDayForNoticeOfSale || receivedDate > auction_date)) {
                    console.warn(`Found NOS with received date ${receivedDate.toISOString().split('T')[0]}, more than 90 days before auction date ${auction_date.toISOString().split('T')[0]}; SKIPPING`)
                    continue
                } else {
                    console.warn(`Found NOS with received date ${receivedDate.toISOString().split('T')[0]}, auction date ${auction_date.toISOString().split('T')[0]}; PROCEEDING`)
                }

                downloadUrl = await page.$eval("#form > div.tabBody > table > tbody > tr:last-child > td:nth-child(2) > a", el => el.href)
            } catch (e) {
                console.warn(`\n\n${index_number} ${dir} couldn't find a valid download link.`)
                continue
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
    download_filing(process.argv[2], process.argv[3], new Date(process.argv[4]), endpoint).catch(err => {
        console.error(err.stack || err);
        process.exitCode = 1;
    }).then(() => { process.exitCode = 0 })
    .finally(() => { process.exit()});
}

