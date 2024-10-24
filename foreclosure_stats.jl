using Dates, CSV, DataFrames

cases = CSV.read("foreclosures/cases.csv", DataFrame)
lots = CSV.read("foreclosures/lots.csv", DataFrame)
bids = CSV.read("foreclosures/bids.csv", DataFrame)
sales = CSV.read("foreclosures/auction_sales.csv", DataFrame)


month = Date("2024-09-30")

cases = cases[(month - Month(1)) .< cases.auction_date .<= month, :]
bids = bids[(month - Month(1)) .< bids.auction_date .<= month, :]
sales = sales[(month - Month(1)) .< sales[!, "SALE DATE"] .<= (month + Month(3)), :]

auctions = innerjoin(cases, lots, on = [:case_number, :borough])
leftjoin!(auctions, bids, on = [:case_number, :borough, :auction_date])

merged_df = innerjoin(sales, auctions, on = [:BOROUGH => :borough, :BLOCK => :block, :LOT => :lot])


boro_auctions = combine(groupby(auctions, :borough), 
        :case_number => length => :count, 
)

completed_auctions = dropmissing(auctions, :winning_bid)
sold_auctions = filter(:winning_bid => >(100), completed_auctions)


boro_sales = combine(groupby(sold_auctions, :borough),
    :winning_bid => length => :sold_count,
    :judgement => mean,
    :upset_price => mean,
    :winning_bid => mean,
    [:upset_price, :judgement] => ((u, j) -> mean(u ./ j)) => :avg_upset_to_judgement,
    [:upset_price, :winning_bid] => ((u, w) -> mean(filter(isfinite, w ./ u))) => :avg_overbid
)

boro_completes = combine(groupby(completed_auctions, :borough), nrow => :completed)

df = outerjoin(boro_auctions, boro_completes, boro_sales, on=:borough)
df[:, r"mean|count"] = coalesce.(df[:, r"mean|count"],0)
df

