using Dates, CSV, DataFrames

cases = CSV.read("foreclosures/cases.csv", DataFrame)
lots = CSV.read("foreclosures/lots.csv", DataFrame)
bids = CSV.read("foreclosures/bids.csv", DataFrame)
sales = CSV.read("foreclosures/auction_sales.csv", DataFrame)


month = Date("2024-09-30")

cases = cases[(month - Month(1)) .< cases.auction_date .<= month, :]
bids = bids[(month - Month(1)) .< bids.auction_date .<= month, :]
sales = sales[(month - Month(1)) .< sales[!, "SALE DATE"] .<= (month + Month(1)), :]

auctions = innerjoin(cases, lots, on = [:case_number, :borough])
leftjoin!(auctions, bids, on = [:case_number, :borough, :auction_date])

merged_df = innerjoin(sales, auctions, on = [:BOROUGH => :borough, :BLOCK => :block, :LOT => :lot])


boro_auctions = combine(groupby(auctions, :borough), 
        :case_number => length => :count, 
)

sold_auctions = filter(:winning_bid => >(100), dropmissing(auctions, :winning_bid))

boro_sales = combine(groupby(sold_auctions, :borough),
    :winning_bid => length => :sold_count,
    :judgement => sum,
    :winning_bid => sum,
    [:upset_price, :winning_bid] => ((u, w) -> mean(w ./ u)) => :avg_overbid
)

df = outerjoin(boro_auctions, boro_sales, on=:borough)
df.judgement_sum = coalesce.(df.judgement_sum, 0)
df.winning_bid_sum = coalesce.(df.winning_bid_sum, 0)
df.sold_count = coalesce.(df.sold_count, 0)
df

