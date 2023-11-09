using DataFrames, Dates, CSV, GLM

df = CSV.read("transactions/nyc_2018-2022.csv", DataFrame)
boroughs = ["manhattan", "bronx", "brooklyn", "queens", "statenisland"]
rolling_sales = vcat([CSV.read("transactions/$borough.csv", DataFrame) for borough in boroughs]...)

# Filter for sales after Dec 31 2022
rolling_sales = filter(row -> row["SALE DATE"] > Date(2022, 12, 31), rolling_sales)

# merge annuals and rolling
df = vcat(df, rolling_sales)

borough_dict = Dict(1 => "Manhattan", 2 => "Bronx", 3 => "Brooklyn", 4 => "Queens", 5 => "Staten Island")
df[!, "BOROUGH"] = map(borough_id -> borough_dict[borough_id], df[!, "BOROUGH"])

df = filter(row -> row["SALE PRICE"] >100000, df)

SFH_CATEGORIES = r"01"
COOP_CATEGORIES = r"09|[^-]10|17"
CONDO_CATEGORIES = r"12|13"

df.house_class = map(row -> 
    occursin(SFH_CATEGORIES, row["BUILDING CLASS CATEGORY"]) ? "SFH" 
    : occursin(COOP_CATEGORIES, row["BUILDING CLASS CATEGORY"]) ? "Coop"
    : "Condo", 
    eachrow(df))

# filter for only house classes
df = filter(row -> row.house_class in ["Coop", "Condo", "SFH"], df)

# Create uid for condos and sfh based on block and lot numbers
condo_sfh_filter = filter(row -> row.house_class in ["Condo", "SFH"], df)
condo_sfh_filter.uid = string.(condo_sfh_filter.BLOCK,'_', condo_sfh_filter.LOT)

# Create uid for coops based on block and apartment number
coops_filter = filter(row -> row.house_class == "Coop", df)
replace.(lowercase.(get.(split.(coops_filter.ADDRESS, ", ", limit=2), 2, "")), r"(?:UNIT)?(?:APT)?[^a-z0-9\n]" => "")
coops_filter.apartment = replace.(lowercase.(get.(split.(coops_filter.ADDRESS, ", ", limit=2), 2, "")), r"(?:unit)?(?:apt)?[^A-Z0-9\n]" => "")

coops_filter.uid = string.(coops_filter.BLOCK, '_', coops_filter.apartment)
coops_filter = filter(row -> row.apartment != "", coops_filter)

df = vcat(coops_filter[!, Not(:apartment)], condo_sfh_filter)

df = rename(df, "BOROUGH" => :borough, "SALE DATE" => :sale_date, "SALE PRICE" => :sale_price, "NEIGHBORHOOD" => :neighborhood)

cols = [:borough, :sale_date, :uid, :sale_price, :house_class, :neighborhood]
archive = CSV.read("transactions/nyc_real_estate_211231.csv", DataFrame)[!, cols]
dropmissing!(archive, [:uid])
archive = filter(row -> row.sale_date < Date(2018, 1, 1), archive)

df = vcat(df[:, cols], archive[:, cols])

# the city shifts to uppercase in 2018, so we must uppercase all neighborhood names
df.neighborhood = uppercase.(df.neighborhood)

# Convert 'sale_date' to PeriodIndex with frequency
df[!, :period] = Dates.lastdayofmonth.(df.sale_date)

# Drop duplicates based on 'period' and 'uid', keeping the last one
dropmissing!(df, [:period, :uid])
unique!(df, [:period, :uid])

df = df[df.sale_price.>1.0e5, :] |> df -> sort(df, [:uid, :sale_date])
grouped = groupby(df, ["borough", "uid"])
grouped = grouped[combine(grouped, nrow).nrow.>1]
df = combine(grouped, names(df)...)

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