# manhattan
Real estate information for NYC.

See [index values and transaction data](https://ivoytov.github.io/manhattan/)

See [foreclosure auction data](https://ivoytov.github.io/manhattan/auctions.html)

[Methodology](https://www.zillow.com/tech/weighted-repeat-sales/) is similar to the early Zillow HPI 

[Search Engine](https://iapps.courts.state.ny.us/nyscef/CaseSearch) for court cases by number

[Manhattan Auction Calendar](https://www.nycourts.gov/legacypdfs/courts/1jd/supctmanh/foreclosures/auctions.pdf)

All charts to have month over month change
1. \# Auctions by borough 
2. % of auctions with a sale
3. Average sale price
4. Average price to upset price ratio

## SQLite data bundle

- All CSV datasets are packaged into `data/nyc_data.sqlite` so the site can load them through sql.js (SQLite compiled to WebAssembly) instead of downloading multiple CSV files.
- Regenerate the database after changing any CSV by running `python3 scripts/build_sqlite.py`. Use the `--database` flag to override the output path if needed.
- The script performs light type inference, preserves the original column names, and creates a `transactions_combined` view that mirrors the previous client-side union of the borough and recent NYC transactions files.
- The browser locates the accompanying `sql-wasm.wasm` from the CDN, so no additional build steps are required beyond publishing the updated database file.
