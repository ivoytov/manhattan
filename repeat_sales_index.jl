using DataFrames, Dates, CSV, GLM

# Function for creating the matrix for the regression model
function create_regression_matrix(grouped, periods)
    total_transactions = sum(nrow(group) - 1 for group in grouped)
    num_periods = length(periods)
    
    # Initialize matrices
    X = zeros(Int64, total_transactions, num_periods)
    Y = zeros(Float64, total_transactions)
    delta_days = zeros(Int64, total_transactions)
    
    # Fill the matrices
    row_index = 1
    for group in grouped
        for i in 1:nrow(group) - 1
            buy = group[i, :]
            sell = group[i + 1, :]
            q1_index = findfirst(==(buy.period), periods)
            q2_index = findfirst(==(sell.period), periods)
            X[row_index, q1_index] = -1
            X[row_index, q2_index] = 1
            Y[row_index] = log(sell.sale_price) - log(buy.sale_price)
            delta_days[row_index] = Dates.days(sell.period - buy.period)
            row_index += 1
        end
    end
    return X, Y, delta_days
end

# Function for computing weighted regression
function compute_weighted_regression(X, Y, delta_days)

    data_frame = DataFrame(X, Symbol.("Q" .* string.(1:size(X, 2))))
    data_frame.Y = Y
    formula = term(:Y) ~ term(0) + sum([term("Q$i") for i in 1:size(X, 2)])

    # Least squares regression
    lm_model = lm(formula, data_frame)
    residuals_squared = residuals(lm_model) .^ 2
    
    # Weighted model
    R = DataFrame(Δ = delta_days, e_squared = residuals_squared)
    w_model = lm(@formula(e_squared ~ 0 + Δ), R)
    weights = 1 ./ sqrt.(predict(w_model))
    replace!(weights, Inf=>1)
    
    # Weighted least squares regression
    wrs_model = lm(formula, data_frame, wts=weights)
    return wrs_model
end

# Calculate the home price index
function calculate_home_price_index(df)
    grouped = groupby(df, [:borough, :uid])

    if isempty(grouped)
        return DataFrame()
    end
    
    # Get unique periods and sort them
    periods = sort(unique(df.period))
    
    # Prepare data for regression
    X, Y, delta_days = create_regression_matrix(grouped, periods)
    if isempty(Y)
        return DataFrame()
    end
    
    # Weighted regression
    wrs_model = compute_weighted_regression(X, Y, delta_days)
    
    # Prepare the index DataFrame
    index_values = coef(wrs_model)
    base_index = index_values[1]
    DataFrame(period = periods, home_price_index = round.(100 * exp.(index_values) / exp(base_index)), digits=1)
end

# Function to read CSV file into DataFrame
read_csv = file -> CSV.read(file, DataFrame)

# Read the base annual transaction data
df = read_csv("transactions/nyc_2018-2022.csv")

# Consolidate rolling sales data for each borough and filter for sales after the specified date
boroughs = ["manhattan", "bronx", "brooklyn", "queens", "statenisland"]
rolling_sales = reduce(vcat, [read_csv("transactions/$borough.csv") for borough in boroughs])
rolling_sales = filter(["SALE DATE"] => >(Date(2022, 12, 31)), rolling_sales)

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
filter!(:house_class => ∈(["Coop", "Condo", "SFH"]), df)

# Read the archive and filter
cols = collect(values(rename_cols))
archive = read_csv("transactions/nyc_real_estate_211231.csv")[!, cols]
filter!(:sale_date => <(Date(2018, 1, 1)), archive)

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
df.neighborhood = titlecase.(lowercase.(df.neighborhood))
df.period = Dates.lastdayofmonth.(df.sale_date)

# Remove duplicates and filter based on sale price
unique!(df, [:period, :uid])
filter!(:sale_price => price -> 2.5e5 < price < 1.5e7, df)
sort!(df, [:sale_date])

# Define the outlier flagging function for individual transactions
function is_outlier_transaction(buy_price, buy_date, sell_price, sell_date; max_change=0.3)
    if ismissing(buy_price) || ismissing(buy_date)
        return false
    end
    
    diff = abs(log(sell_price) - log(buy_price))
    period = max(1, Dates.value(sell_date - buy_date) / 365.25)
    return diff / period > max_change 
end

grouped_df = groupby(df, [:borough, :uid])

# Add columns for the previous sale price and date
df_prev_info = grouped_df |>
    x -> transform(x, :sale_price => lag => :prev_sale_price, 
                      :sale_date => lag => :prev_sale_date)

# Flag transactions as outliers
df_prev_info = transform(df_prev_info, [:prev_sale_price, :prev_sale_date, :sale_price, :sale_date] => ByRow(is_outlier_transaction) => :is_outlier)

# Identify outliers for display purposes
outliers = (
    df_prev_info[df_prev_info.is_outlier, :]
    |> df -> select(df, :block, :lot, :sale_date, :sale_price)
    |> df -> filter(:sale_date => ≥(Date(2018, 1, 1)), df)
    |> df -> rename(df, :sale_date => "SALE DATE")
)

# Filter out the outlier transactions
df = filter(:is_outlier => !, df_prev_info)

# Filter for reasonable transaction frequencies
grouped_df = groupby(df, [:borough, :uid])
transaction_limits = (x -> 1 < x < 10)
grouped_df = filter(gp -> transaction_limits(nrow(gp)), grouped_df)

# Calculating and exporting home price indices
home_price_index = calculate_home_price_index(df)
home_price_subindex = combine(groupby(df, [:borough, :house_class])) do sdf
    calculate_home_price_index(sdf)
end
home_price_neighborhoods = combine(groupby(df, [:borough, :neighborhood])) do sdf
    calculate_home_price_index(sdf)
end

CSV.write("home_price_index.csv", home_price_index)
CSV.write("home_price_subindex.csv", sort(home_price_subindex, [:borough, :house_class, :period]))
CSV.write("home_price_neighborhoods.csv", sort(home_price_neighborhoods, [:borough, :neighborhood, :period]))
CSV.write("transactions/outliers.csv", outliers)
