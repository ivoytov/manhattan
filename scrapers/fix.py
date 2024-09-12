# %%
import pandas as pd
from pathlib import Path

df = pd.read_csv("transactions/foreclosure_auctions.csv")

# borough,date,case_number,case_name,block,lot,judgement,address
df = df[~df.case_number.str.contains('.pdf')].copy()
df['lot'] = df['lot'].apply(lambda x: f"{x:g}" if pd.notnull(x) else '')
df['block'] = df['block'].apply(lambda x: f"{x:g}" if pd.notnull(x) else '')

cases = df[['case_number','borough','date','case_name']]
cases.to_csv("transactions/foreclosure_cases.csv", index=False)

lots = df[['case_number','borough','block','lot','address']]
lots.to_csv("transactions/foreclosure_lots.csv", index=False)

results = df[['case_number', 'borough','judgement']]
results['upset_price'] = None
results['winning_bid'] = None
results.to_csv("transactions/auction_results.csv", index=False)


