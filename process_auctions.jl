using DataFrames, Dates, CSV, GLM, Statistics

# Function to read CSV file into DataFrame
function read_csv(file)
    CSV.read(file, DataFrame)
end

# Initialize and preprocess datasets
function initialize_data()
    base_df = read_csv("transactions/nyc_2018-2022.csv")
    archives = [read_csv("transactions/nyc_sales_$(year).csv") for year in 2003:2017]
    rolling_sales = reduce(vcat, [read_csv("transactions/$borough.csv") for borough in ["manhattan", "bronx", "brooklyn", "queens", "statenisland"]])
    rolling_sales = filter(["SALE DATE"] => >(Date(2022, 12, 31)), rolling_sales)

    df = vcat(base_df, vcat(archives...), rolling_sales, cols=:intersect)
    borough_dict = Dict(1 => "Manhattan", 2 => "Bronx", 3 => "Brooklyn", 4 => "Queens", 5 => "Staten Island")
    df.BOROUGH = [borough_dict[id] for id in df.BOROUGH]
    df
end

# Main function to calculate and export home price indices
function main()
    sales = initialize_data()
    auctions = read_csv("transactions/foreclosure_auctions.csv")
    
    # Add 'borough' column with value 'Manhattan' to auctions DataFrame
    auctions.BOROUGH = fill("Manhattan", nrow(auctions))

    # Merge auctions and sales DataFrames
    auctions = dropmissing(auctions, [:block, :lot])    
    merged_df = innerjoin(sales, auctions, on = [:BOROUGH, :BLOCK => :block, :LOT => :lot])
    # Select only columns from sales DataFrame
    merged_df = select(merged_df, names(sales))
    
    CSV.write("transactions/auction_sales.csv", merged_df)
end

main()


