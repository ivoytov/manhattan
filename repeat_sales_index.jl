using DataFrames, Dates, CSV, GLM


df = CSV.read("transactions/nyc_2018-2022.csv", DataFrame)
boroughs = ["manhattan", "bronx", "brooklyn", "queens", "statenisland"]
rolling_sales = vcat([CSV.read("transactions/$borough.csv", DataFrame) for borough in boroughs]...)

# Filter for sales after Dec 31 2022
rolling_sales = filter(row -> row["SALE DATE"] > Date(2022, 12, 31), rolling_sales)

# merge annuals and rolling
df = vcat(df, rolling_sales)
df = rename(df, "ADDRESS" => :address, "BOROUGH" => :borough, "SALE DATE" => :sale_date, "SALE PRICE" => :sale_price, "NEIGHBORHOOD" => :neighborhood, "BUILDING CLASS CATEGORY" => :house_class, "BLOCK" => :block, "LOT" => :lot)

borough_dict = Dict(1 => "Manhattan", 2 => "Bronx", 3 => "Brooklyn", 4 => "Queens", 5 => "Staten Island")
df.borough = map(borough_id -> borough_dict[borough_id], df.borough)

df.house_class = map(house_class -> occursin(r"01", house_class) ? "SFH" : occursin(r"12|13", house_class) ? "Condo" : occursin(r"09|[^-]10|17", house_class) ? "Coop" : "Other", df.house_class)

# filter for only house classes
filter!(:house_class => in(["Coop", "Condo", "SFH"]), df)

cols = [:borough, :sale_date, :sale_price, :house_class, :neighborhood, :address, :block, :lot]
archive = CSV.read("transactions/nyc_real_estate_211231.csv", DataFrame)[!, cols]
filter!(:sale_date => <(Date(2018, 1, 1)), archive)

df = vcat(df[:, cols], archive[:, cols])

df.uid = map(eachrow(df)) do row
    # for homes and condos, uid is like 123_890 for block 123, lot 890
    if row.house_class in ["Condo", "SFH"]
        return string(row.block, '_', row.lot)
    end

    # for coops, uid is like 123_890_3a for block 123, lot 890, apartment 3A
    apartment = replace(lowercase(get(split(row.address, ", ", limit=2), 2, "")), r"(?:unit)?(?:apt)?[^a-z0-9\n]" => "")
    apartment == "" && return missing
    string(row.block, '_', row.lot, '_', apartment)
end
dropmissing!(df, [:uid])

# the city shifts to uppercase neighborhood names in 2018, so we must uppercase all neighborhood names
df.neighborhood = uppercase.(df.neighborhood)

# Convert 'sale_date' to PeriodIndex with frequency
df.period = Dates.lastdayofmonth.(df.sale_date)

# Drop duplicates based on 'period' and 'uid', keeping the last one
unique!(df, [:period, :uid])

# filter transactions to only betweeen $250k and $15MM
filter!(row -> 2.5e5 < row.sale_price < 1.5e7, df)
sort!(df, [:sale_date])

grouped = groupby(df, [:borough, :uid])
# filter homes that sold between 2 and 9 times (>9 is likely bad data...)
grouped = grouped[1 .< combine(grouped, nrow).nrow .< 10]

# Calculate percentage change per year of ownership. don't annualize returns under 1 year in duration
func_max_pct_change = [:sale_price, :sale_date] => ((price, date) ->
    maximum(
        abs.(log.(price[2:end]) .- log.(price[1:end-1])) ./ max.(1, Dates.value.(date[2:end] .- date[1:end-1]) ./ 365.25)
    )) => :pct_change_per_year

# record outliers to display on the web
outliers = combine(grouped[combine(grouped, func_max_pct_change).pct_change_per_year .>= 0.3], :block, :lot, :sale_date => "SALE DATE", :sale_price)
filter!(["SALE DATE"] => >=(Date(2018, 1, 1)), outliers)
CSV.write("transactions/outliers.csv", outliers)

# filter out any homes that had lost or gained value at over 30% per annum
grouped = grouped[combine(grouped, func_max_pct_change).pct_change_per_year .< 0.3]
df = combine(groupby(df, [:borough, :uid]), names(df)...)

function calc_index(df)
    grouped = groupby(df, [:borough, :uid])

    rng = sort(unique(df.period))

    n = sum(combine(grouped, gp -> nrow(gp) - 1).x1)
    p = size(rng, 1)  # degrees of freedom aka num of periods
    X = zeros(Int64, (n, p))
    Y = zeros(Float64, (n, 1))
    Δ = zeros(Int64, (n, 1))
    row = 1

    # in case of blank matrix, return empty frame
    if n == 0
        return DataFrame()
    end

    for group in grouped
        for i in 1:size(group, 1)-1
            buy = group[i, :]
            sell = group[i+1, :]
            q₁ = findfirst(rng .== buy.period)
            q₂ = findfirst(rng .== sell.period)
            X[row, q₁] = -1
            X[row, q₂] = 1
            Y[row] = log(sell.sale_price) - log(buy.sale_price)
            Δ[row] = length(buy.period:Month(1):sell.period)

            row += 1
        end
    end

    x = DataFrame(X, Symbol.(rng))
    x[!, :Y] = Y[:]
    formula = term(:Y) ~ term(0) + sum(term.(Symbol.(rng)))

    lm_model = lm(formula, x)
    e = residuals(lm_model)

    R = DataFrame(hcat(Δ, e), [:Δ, :e])
    w_model = lm(@formula(e^2 ~ 0 + Δ), R)

    w = 1 ./ sqrt.(predict(w_model))

    w[isinf.(w)] .= 1
    wrs_model = lm(formula, x, wts=w)

    idx = DataFrame(period=rng, home_price_index=100 * ℯ .^ coef(wrs_model))
    idx.home_price_index = 100 * idx.home_price_index ./ idx.home_price_index[1]
    idx[:, Not(:period)] = round.(idx[:, Not(:period)], digits=2)
    idx
end

idx = calc_index(df)
CSV.write("home_price_index.csv", idx)

gdf = groupby(df, [:borough, :house_class])
idxb = combine(gdf) do sdf
    calc_index(sdf)
end

CSV.write("home_price_subindex.csv", idxb)

gdf = groupby(df, [:borough, :neighborhood])
idx_neigh = combine(gdf) do sdf
    calc_index(sdf)
end

CSV.write("home_price_neighborhoods.csv", idx_neigh)