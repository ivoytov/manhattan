using DataFrames, Dates, CSV, GLM

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

# Function to read CSV file into DataFrame
read_csv = file -> CSV.read(file, DataFrame)

# Read the base annual transaction data
df = read_csv("transactions/nyc_2018-2022.csv")

# Consolidate rolling sales data for each borough and filter for sales after the specified date
boroughs = ["manhattan", "bronx", "brooklyn", "queens", "statenisland"]
rolling_sales = reduce(vcat, [read_csv("transactions/$borough.csv") for borough in boroughs])
rolling_sales = filter(row -> row["SALE DATE"] > Date(2022, 12, 31), rolling_sales)

# Combine annuals and rolling data sets
df = vcat(df, rolling_sales)

# Rename columns for consistency
rename_cols = Dict(
    "ADDRESS" => :address,
    "BOROUGH" => :borough,
    "SALE DATE" => :sale_date,
    "SALE PRICE" => :sale_price,
    "NEIGHBORHOOD" => :neighborhood,
    "BUILDING CLASS CATEGORY" => :house_class,
    "BLOCK" => :block,
    "LOT" => :lot
)
df = rename(df, rename_cols)

# Mapping for borough names
borough_dict = Dict(1 => "Manhattan", 2 => "Bronx", 3 => "Brooklyn", 4 => "Queens", 5 => "Staten Island")
df.borough = [borough_dict[id] for id in df.borough]

# Simplify building class names using regex
house_class_map = house_class -> begin
    if occursin(r"01", house_class) "SFH"
    elseif occursin(r"12|13", house_class) "Condo"
    elseif occursin(r"09|[^-]10|17", house_class) "Coop"
    else "Other"
    end
end
df.house_class = map(house_class_map, df.house_class)

# Filter for specific house classes
filter!(row -> row.house_class ∈ ["Coop", "Condo", "SFH"], df)

# Read the archive and filter
cols = [:borough, :sale_date, :sale_price, :house_class, :neighborhood, :address, :block, :lot]
archive = read_csv("transactions/nyc_real_estate_211231.csv")[!, cols]
filter!(row -> row.sale_date < Date(2018, 1, 1), archive)

# Concatenate df and archive keeping only the selected columns
df = vcat(df[:, cols], archive)

# Function to generate unique identifiers for properties
function generate_uid(row)
    base_uid = string(row.block, '_', row.lot)
    if row.house_class ∈ ["Condo", "SFH"]
        return base_uid
    else
        apartment = replace(lowercase(get(split(row.address, ", ", limit=2), 2, "")), r"(?:unit)?(?:apt)?[^a-z0-9\n]" => "")
        return apartment == "" ? missing : "$(base_uid)_$apartment"
    end
end

df.uid = map(generate_uid, eachrow(df))
dropmissing!(df, [:uid])

# Standardize neighborhood names and calculate periods
df.neighborhood = uppercase.(df.neighborhood)
df.period = Dates.lastdayofmonth.(df.sale_date)

# Remove duplicates and filter based on sale price
unique!(df, [:period, :uid])
filter!(row -> 2.5e5 < row.sale_price < 1.5e7, df)
sort!(df, [:sale_date])

# Filter for reasonable transaction frequencies
grouped_df = groupby(df, [:borough, :uid])
transaction_limits = (x -> 1 < x < 10)
grouped_df = filter(gp -> transaction_limits(nrow(gp)), grouped_df)

# Function to calculate the maximum percentage change per year of ownership
pct_change_per_year = (prices, dates) -> begin
    diffs = abs.(diff(log.(prices)))
    periods = max.(1, Dates.value.(diff(dates)) / 365.25)
    maximum(diffs ./ periods; init=0)
end

# Identify outliers and write to CSV
is_outlier = gp -> pct_change_per_year(gp.sale_price, gp.sale_date) ≥ 0.3
outliers = (grouped_df
                |> gp -> filter(is_outlier, gp)
                |> gp -> combine(gp, :block, :lot, :sale_date, :sale_price)
                |> df -> filter(:sale_date => date -> date ≥ Date(2018, 1, 1), df)
                |> df -> rename(df, :sale_date => "SALE DATE")
)
CSV.write("transactions/outliers.csv", outliers)

# Remove outliers from the main dataframe
df = filter(gp -> !is_outlier(gp), grouped_df) |> gdf -> combine(gdf, names(df)...)

# Calculating and exporting home price indices
home_price_index = calc_index(df)
home_price_subindex = combine(groupby(df, [:borough, :house_class])) do sdf
    calc_index(sdf)
end
home_price_neighborhoods = combine(groupby(df, [:borough, :neighborhood])) do sdf
    calc_index(sdf)
end

CSV.write("home_price_index.csv", home_price_index)
CSV.write("home_price_subindex.csv", home_price_subindex)
CSV.write("home_price_neighborhoods.csv", home_price_neighborhoods)




