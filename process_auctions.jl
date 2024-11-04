using DataFrames, Dates, CSV, GLM, Statistics, GeoJSON, JSON3, HTTP


# Function to read CSV file into DataFrame
read_csv(file) = CSV.read(file, DataFrame)

borough_dict = Dict(1 => "Manhattan", 2 => "Bronx", 3 => "Brooklyn", 4 => "Queens", 5 => "Staten Island")
borough_id_dict = Dict("Manhattan" => "1", "Bronx"=>"2", "Brooklyn"=>"3", "Queens" =>"4", "Staten Island"=>"5")


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

    # drop timeshares (condo hotels)
    exclude_prefixes = ["45", "25", "26", "28"]
    filter!(row -> !ismissing(row."BUILDING CLASS CATEGORY") &&
        all(prefix -> !startswith(row."BUILDING CLASS CATEGORY", prefix), exclude_prefixes), merged_df)    
    CSV.write("foreclosures/auction_sales.csv", merged_df)

end


function condo_base_bbl_key(borough, block, lot)
    outfields = "CONDO_BASE_BBL_KEY"
    url = "https://services6.arcgis.com/yG5s3afENB5iO9fj/arcgis/rest/services/DTM_ETL_DAILY_view/FeatureServer/4"
    # query = "Borough = 'MX' and Block = 459 and Lot = 1113"
    query = "UNIT_BORO = '$(borough_id_dict[borough])' and UNIT_BLOCK=$block and UNIT_LOT=$lot"
    @show query
    result = esri_query(url, outfields, query)
    return result[1]["attributes"]["CONDO_BASE_BBL_KEY"]
end

function esri_query(url, outfields, query)
    params = Dict("f"=>"JSON", "outfields"=>outfields, "where"=>query)
    r = HTTP.request("POST", "$(url)/query",
                 ["Content-Type" => "application/x-www-form-urlencoded", "accept"=>"application/json"],
                 HTTP.URIs.escapeuri(params))
    json = JSON3.read(String(r.body))
    return json.features
end

function condo_billing_bbl(condo_base_bbl_key)
    outfields = "CONDO_BILLING_BBL"
    url = "https://services6.arcgis.com/yG5s3afENB5iO9fj/arcgis/rest/services/DTM_ETL_DAILY_view/FeatureServer/3"
    # query = "Borough = 'MX' and Block = 459 and Lot = 1113"
    query = "CONDO_BASE_BBL_KEY = $condo_base_bbl_key"
    result = esri_query(url, outfields, query) 
    return result[1]["attributes"]["CONDO_BILLING_BBL"]
end

function pluto(bbl)
    outfields = "*"
    url = "https://services5.arcgis.com/GfwWNkhOj9bNBqoJ/ArcGIS/rest/services/MAPPLUTO/FeatureServer/0"
    query = "BBL = $bbl"
    result = esri_query(url, outfields, query) 
    return result[1]["attributes"]
end
main()


