using DataFrames, Dates, CSV, GLM, Statistics

# Function to read CSV file into DataFrame
function read_csv(file)
    CSV.read(file, DataFrame)
end

# Function to preprocess the DataFrame
function preprocess_data(df)
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
    
    borough_dict = Dict(1 => "Manhattan", 2 => "Bronx", 3 => "Brooklyn", 4 => "Queens", 5 => "Staten Island")
    df.borough = [borough_dict[id] for id in df.borough]

    house_class_map = house_class -> begin
        if ismissing(house_class) "Other"
        elseif occursin(r"01", house_class) "SFH"
        elseif occursin(r"12|13", house_class) "Condo"
        elseif occursin(r"09|[^-]10|17", house_class) "Coop"
        else "Other"
        end
    end
    df.house_class = map(house_class_map, df.house_class)
    filter!(:house_class => ∈(["Coop", "Condo", "SFH"]), df)

    df.uid = map(generate_uid, eachrow(df))
    dropmissing!(df, [:uid])

    df.neighborhood = titlecase.(lowercase.(strip.(df.neighborhood)))
    df.period = Dates.lastdayofmonth.(df.sale_date)
    unique!(df, [:period, :uid])
    filter!(:sale_price => price -> 2.5e5 < price < 1.5e7, df)
    sort!(df, [:sale_date])
    
    df
end

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

# Define the outlier flagging function for individual transactions
function is_outlier_transaction(buy_price, buy_date, sell_price, sell_date; max_change=0.3)
    if ismissing(buy_price) || ismissing(buy_date)
        return false
    end
    
    diff = abs(log(sell_price) - log(buy_price))
    period = max(1, Dates.value(sell_date - buy_date) / 365.25)
    return diff / period > max_change 
end

# Initialize and preprocess datasets
function initialize_data()
    base_df = read_csv("transactions/nyc_sales_2018-2022.csv")
    archives = [read_csv("transactions/nyc_sales_$(year).csv") for year in 2003:2017]
    rolling_sales = reduce(vcat, [read_csv("transactions/$borough.csv") for borough in ["manhattan", "bronx", "brooklyn", "queens", "statenisland"]])
    rolling_sales = filter(["SALE DATE"] => >(Date(2022, 12, 31)), rolling_sales)

    combined_df = vcat(base_df, vcat(archives...), rolling_sales, cols=:intersect)
    preprocess_data(combined_df)
end

# Function for creating the matrix for the regression model
function create_regression_matrix(grouped, periods)
    total_transactions = sum(nrow(group) - 1 for group in grouped)
    num_periods = length(periods)
    
    X = zeros(Int64, total_transactions, num_periods)
    Y = zeros(Float64, total_transactions)
    delta_days = zeros(Int64, total_transactions)
    
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

    lm_model = lm(formula, data_frame)
    residuals_squared = residuals(lm_model) .^ 2
    
    R = DataFrame(Δ = delta_days, e_squared = residuals_squared)
    w_model = lm(@formula(e_squared ~ 0 + Δ), R)
    weights = 1 ./ sqrt.(predict(w_model))
    replace!(weights, Inf => 1)
    
    wrs_model = lm(formula, data_frame, wts=weights)
    wrs_model
end

# Calculate the home price index
function calculate_home_price_index(df)
    grouped = groupby(df, [:borough, :uid])
    
    if isempty(grouped)
        return DataFrame()
    end
    
    periods = sort(unique(df.period))
    X, Y, delta_days = create_regression_matrix(grouped, periods)
    
    if isempty(Y)
        return DataFrame()
    end
    
    wrs_model = compute_weighted_regression(X, Y, delta_days)
    index_values = coef(wrs_model)
    base_index = index_values[1]
    rounded_values = round.(100 * exp.(index_values) / exp(base_index), digits=1)
    
    DataFrame(period = periods, home_price_index = rounded_values)
end

# Identify homes that ever transacted in the given percentile
function filter_homes_in_percentile(df, pct)
    df.year = year.(df.sale_date)
    chosen_pct_uids = Set{String}()
    
    for (year, sdf) in pairs(groupby(df, :year))
        threshold_value = quantile(sdf.sale_price, pct)
        pct_uids_in_year = unique(filter(row -> row.sale_price >= threshold_value, sdf).uid)
        union!(chosen_pct_uids, pct_uids_in_year)
    end
    
    filter(row -> row.uid in chosen_pct_uids, df)
end

# Split data into top third, bottom third, and middle third
function filter_thirds(df)
    all_homes = df
    top_decile = filter_homes_in_percentile(df, .9)
    bottom_decile = filter_homes_in_percentile(df, .1)

    top_third = filter_homes_in_percentile(df, 2/3)
    bottom_third = filter_homes_in_percentile(df, 1/3)
    middle_third_uids = setdiff(filter_homes_in_percentile(df, 1/3).uid, top_third.uid)
    middle_third = filter(row -> row.uid in middle_third_uids, df)
    
    Dict("all" => all_homes, "top_decile" => top_decile, "top_third" => top_third, "middle_third" => middle_third, "bottom_third" => bottom_third, "bottom_decile" => bottom_decile)
end

# Main function to calculate and export home price indices
function main()
    df = initialize_data()
    
    # Add columns for the previous sale price and date
    grouped_df = groupby(df, [:borough, :uid])
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
    
    datasets = filter_thirds(df)

    final_index = DataFrame(period=sort(unique(df.period)))

    for (key, dataset) in datasets
        println("Computing index for $key")
        home_price_index = calculate_home_price_index(dataset)
        rename!(home_price_index, :home_price_index => Symbol(key))  # Rename column to the segment name
        final_index = leftjoin(final_index, home_price_index, on=:period)  # Join to form a wide DataFrame
    end
        
    CSV.write("home_price_index.csv", final_index)
    CSV.write("transactions/outliers.csv", outliers)

    println("Computing indices by borough")
    home_price_subindex = combine(groupby(df, [:borough, :house_class])) do sdf
        calculate_home_price_index(sdf)
    end
    CSV.write("home_price_subindex.csv", sort(home_price_subindex, [:borough, :house_class, :period]))

    println("Computing indices by neighborhood")
    home_price_neighborhoods = combine(groupby(df, [:borough, :neighborhood])) do sdf
        calculate_home_price_index(sdf)
    end
    CSV.write("home_price_neighborhoods.csv", sort(home_price_neighborhoods, [:borough, :neighborhood, :period]))
    
    println("COMPLETE")
end

main()