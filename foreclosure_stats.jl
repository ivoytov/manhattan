using Dates, CSV, DataFrames, AlgebraOfGraphics, CairoMakie, Statistics
set_aog_theme!()

borough_dict = Dict("Manhattan" => "MN", "Bronx"=>"BX", "Brooklyn"=>"BK", "Queens" =>"QN", "Staten Island"=>"SI")
building_class_dict = Dict('A' => "Single Family", 'B' => "Duplex", 'C' => "Walk up", 'O' => "Office", 'W' => "Schools", 'Q' => "Parks", 'M' => "Churches", 'E' => "Warehouses", 'D' => "Apartments", 'Z' => "Other", 'H' => "Hotels", 'F' => "Industrial", 'R' => "Condo", 'G' => "Garages", 'S' => "Mixed Use", 'V' => "Land", 'K' => "Retail")


cases = CSV.read("foreclosures/cases.csv", DataFrame)
lots = CSV.read("foreclosures/lots.csv", DataFrame)
bids = CSV.read("foreclosures/bids.csv", DataFrame)
sales = CSV.read("foreclosures/auction_sales.csv", DataFrame)
pluto = CSV.read("foreclosures/pluto.csv", DataFrame)

month = Date("2025-02-28")

cases = cases[(month-Month(1)).<cases.auction_date.<=month, :]
bids = bids[(month-Month(1)).<bids.auction_date.<=month, :]
sales = sales[(month-Month(1)).<sales[!, "SALE DATE"].<=(month+Month(3)), :]

auctions = innerjoin(cases, lots, on=[:case_number, :borough])
auctions.boro_code = [borough_dict[id] for id in auctions.borough]

leftjoin!(auctions, bids, on=[:case_number, :borough, :auction_date])
unique!(pluto, [:Borough, :Block, :Lot])
dropmissing!(auctions, :BBL)
leftjoin!(auctions, pluto, on=:BBL; makeunique=true)
auctions.building_class = [ismissing(id) ? "Other" : building_class_dict[id[1]] for id in auctions.BldgClass]

merged_df = innerjoin(sales, auctions, on=[:BOROUGH => :borough, :BLOCK => :block, :LOT => :lot])


boro_auctions = combine(groupby(auctions, :borough),
    :case_number => length => :count,
)

completed_auctions = dropmissing(auctions, :winning_bid)
sold_auctions = filter(:winning_bid => >(100), completed_auctions)
sold_narrow = stack(sold_auctions, [:judgement, :winning_bid, :upset_price], [:case_number, :borough], variable_name="result_type", value_name="amount")

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
df[:, r"mean|count"] = coalesce.(df[:, r"mean|count"], 0)

filter!(:winning_bid => <=(4.0e6), sold_auctions)
maxy = ceil(max(sold_auctions.winning_bid...) / 5e5) * 500
axis = (width = 225, height = 225, xlabel = "Opening Bid (\$000s)", ylabel = "Winning Bid (\$000s)", limits = ((0, maxy), (0, maxy)))
result_overbid = data(sold_auctions) * mapping(
       :upset_price => (t-> t / 1000) => "Opening Bid (\$000s)", 
       :winning_bid => (t-> t / 1000) => "Winning Bid (\$000s)")
plt = result_overbid * mapping(layout=:borough, marker=:building_class)       

# Define the 45-degree line as a visual element
line_data = DataFrame(x = [0, maxy])
line_45 = data(line_data) * mapping(:x => identity, :x => identity) * visual(Lines,
    linestyle= :dash,
    linewidth = 1)

# Draw the main plot with the line
AlgebraOfGraphics.draw(plt + line_45; axis = axis)