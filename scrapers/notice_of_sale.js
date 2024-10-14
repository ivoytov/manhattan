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

function sleep(s) {
    return new Promise(resolve => setTimeout(resolve, s * 1000));
}

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


export async function download_filing(index_number, county, auction_date, missingFilings, endpoint = SBR_WS_ENDPOINT,) {
    const browser = await connect({
        browserWSEndpoint: endpoint,
    });

    const page = await browser.newPage();

    await page.goto(url, { waitUntil: 'networkidle2', timeout: 2 * 60 * 1000 });
    await sleep(1)

    await page.locator('#txtCaseIdentifierNumber').fill(index_number);
    await sleep(1)
    await page.locator('select#txtCounty').fill(county_map[county]);
    await sleep(1)
    page.keyboard.press('Enter');

    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    await sleep(1)

    try {
        await page.locator('table.NewSearchResults > tbody > tr > td > a').click();
    } catch (e) {
        console.warn(`\n\n${index_number} couldn't find a valid case with this index`)
        return { error: 'Failed to find case in CEF' };
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

    const filename = index_number.replace('/', '-') + ".pdf"
    for (const filing of missingFilings) {
        const { dir, id } = filing
        const pdfPath = path.resolve(`saledocs/${dir}/${filename}`);
        if (!existsSync(pdfPath) && availableFilings.includes(id)) {
            // console.log(`Trying to get filing ${id}`)

            await page.locator('select#selDocumentType').fill(id);
            await sleep(1)
            await page.click('input[name="btnNarrow"]'); // To submit the form
            await page.waitForNetworkIdle();

            let docs = await page.$$eval("table.NewSearchResults > tbody > tr", rows => {
                const out = []
                for (const row of rows) {
                    const link = row.querySelector('td:nth-child(2) a');
                    const received = row.querySelector('td:nth-child(3) span');
                    if (link && received) {
                        out.push({
                            downloadUrl: link.href,
                            receivedDate: received.innerText.split(" ")[1]
                        })
                    }
                }
                return out
            })
            docs = docs.reverse()

            if (docs.length == 0) {
                console.warn("No valid document download links available")
                return { error: 'No valid document links' };

            }

            const receivedDate = new Date(docs[0].receivedDate)
            const downloadUrl = docs[0].downloadUrl

            // if received date is before auction date, this is not the right surplus money form
            if (auction_date && filing == FilingType.SURPLUS_MONEY_FORM && receivedDate < auction_date) {
                console.log(index_number, `Found SMF with received date ${receivedDate.toISOString().split('T')[0]}, before ${auction_date.toISOString().split('T')[0]} auction date; SKIPPING`)
                continue
            }

            // if received date is >90 days before the auction date, this is not the right notice of sale form
            const earliestDayForNoticeOfSale = new Date(auction_date)
            earliestDayForNoticeOfSale.setDate(earliestDayForNoticeOfSale.getDate() - 90)
            if (auction_date && filing == FilingType.NOTICE_OF_SALE && (receivedDate < earliestDayForNoticeOfSale || receivedDate > auction_date)) {
                console.log(index_number, `Found NOS with received date ${receivedDate.toISOString().split('T')[0]}, either after or more than 90 days before ${auction_date.toISOString().split('T')[0]} auction date; SKIPPING`)
                continue
            } 

            await download_pdf(downloadUrl, pdfPath);
            await page.click("input[name='btnClear']")
            await page.waitForNetworkIdle();
        }
    }

    // finish up
    await page.close()
    browser.disconnect();

}

if (import.meta.url === `file://${process.argv[1]}`) {
    const endpoint = process.env.WSS ?? SBR_WS_ENDPOINT;   
    const auction_date = new Date(process.argv[4]) 

    const args = process.argv.slice(2, process.argv.length).join(" ")
    const county = process.argv[3] == 'Staten' ? `${process.argv[3]} ${process.argv[4]}` : process.argv[3]
    console.log(args, "Starting...")
    const missingFilings = []
    if (process.argv.includes('surplusmoney')) {
        missingFilings.push(FilingType.SURPLUS_MONEY_FORM)
    }
    if (process.argv.includes('noticeofsale')) {
        missingFilings.push(FilingType.NOTICE_OF_SALE)
    }
    await download_filing(process.argv[2], county, auction_date, missingFilings, endpoint).catch(err => {
        console.error(args, "Error processing");
        console.error(err)
    })
    console.log(args, "...Completed")
    process.exit()

}

