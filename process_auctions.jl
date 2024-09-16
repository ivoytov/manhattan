using DataFrames, Dates, CSV, GLM, Statistics, GeoJSON, JSON3


# Function to read CSV file into DataFrame
function read_csv(file)
    CSV.read(file, DataFrame)
end

borough_dict = Dict(1 => "Manhattan", 2 => "Bronx", 3 => "Brooklyn", 4 => "Queens", 5 => "Staten Island")

# Initialize and preprocess datasets
function initialize_data()
    base_df = read_csv("transactions/nyc_2018-2022.csv")
    archives = [read_csv("transactions/nyc_sales_$(year).csv") for year in 2003:2017]
    rolling_sales = reduce(vcat, [read_csv("transactions/$borough.csv") for borough in ["manhattan", "bronx", "brooklyn", "queens", "statenisland"]])
    rolling_sales = filter(["SALE DATE"] => >(Date(2022, 12, 31)), rolling_sales)

    df = vcat(base_df, vcat(archives...), rolling_sales, cols=:intersect)
    df.BOROUGH = [borough_dict[id] for id in df.BOROUGH]
    df
end

# Main function to calculate and export home price indices
function main()
    sales = initialize_data()
    auctions = read_csv("foreclosures/lots.csv")
    

    # Merge auctions and sales DataFrames
    dropmissing!(auctions, [:block, :lot])    
    merged_df = innerjoin(sales, auctions, on = [:BOROUGH => :borough, :BLOCK => :block, :LOT => :lot])
    # Select only columns from sales DataFrame
    select!(merged_df, names(sales))

    exclude_prefixes = ["45", "25", "26", "28"]
    filter!(row -> !ismissing(row."BUILDING CLASS CATEGORY") &&
        all(prefix -> !startswith(row."BUILDING CLASS CATEGORY", prefix), exclude_prefixes), merged_df)    
    CSV.write("foreclosures/auction_sales.csv", merged_df)

    fc = GeoJSON.read("lotblock.geojson")
    lb = DataFrame(fc)
    dropmissing!(lb, [:BORO, :BLOCK])
    lb.BORO = [borough_dict[parse(Int, id)] for id in lb.BORO]
    merged_json = innerjoin(lb, auctions, on = [:BORO => :borough, :BLOCK => :block])
    select!(merged_json, [:OBJECTID, :BORO, :BLOCK, :geometry])
    unique!(merged_json)
    features = [feature for feature in fc if feature.OBJECTID in merged_json.OBJECTID]
    GeoJSON.write("foreclosures/auctions.geojson",GeoJSON.FeatureCollection(features=features))

end

main()


