import pandas as pd
from tqdm import tqdm

cols = ['BOROUGH', 'NEIGHBORHOOD', 'BUILDING CLASS CATEGORY',
       'TAX CLASS AT PRESENT', 'BLOCK', 'LOT', 'EASEMENT',
       'BUILDING CLASS AT PRESENT', 'ADDRESS', 'APARTMENT NUMBER', 'ZIP CODE',
       'RESIDENTIAL UNITS', 'COMMERCIAL UNITS', 'TOTAL UNITS',
       'LAND SQUARE FEET', 'GROSS SQUARE FEET', 'YEAR BUILT',
       'TAX CLASS AT TIME OF SALE', 'BUILDING CLASS AT TIME OF SALE',
       'SALE PRICE', 'SALE DATE']

# Download all real estate transaction data from [NYC.gov](https://www1.nyc.gov/site/finance/taxes/property-annualized-sales-update.page) for January 2003 to July 2020. Only closed transactions are included. Column names are the same in all files. 

# ex: https://www1.nyc.gov/assets/finance/downloads/pdf/rolling_sales/annualized-sales/2019/2019_manhattan.xlsx
url_prefix = 'https://www1.nyc.gov/assets/finance/downloads/pdf/rolling_sales'
years = range(2010,2018)
boroughs = ['manhattan', 'brooklyn', 'queens', 'bronx', 'statenisland']
links = []
for borough in boroughs:
  links += [f"{url_prefix}/annualized-sales/{year}/{year}_{borough}.xls{'x' if year > 2017 else ''}" for year in years ]
  links += [url_prefix + f"/rollingsales_{borough}.xlsx", url_prefix + f"/annualized-sales/2009_{borough}.xls",
          f"https://www1.nyc.gov/assets/finance/downloads/pdf/09pdf/rolling_sales/sales_2008_{borough}.xls", 
          f"https://www1.nyc.gov/assets/finance/downloads/excel/rolling_sales/sales_2007_{borough}.xls",
          *[f"https://www1.nyc.gov/assets/finance/downloads/sales_{borough if borough != 'statenisland' else 'si'}_0{n}.xls" for n in range(3,7)] ]

frames = [pd.read_excel(link, skiprows=4, names=cols, parse_dates=[20]) for link in tqdm(links)]
df = pd.concat(frames, ignore_index=True)

df.to_csv('transactions/nyc_pre_2018.csv', index=False)
print("COMPLETE")