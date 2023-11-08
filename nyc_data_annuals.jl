using DataFrames, XLSX

# Define URL prefixes
url_prefix = "https://www.nyc.gov/assets/finance/downloads/pdf/rolling_sales"

# Define years, boroughs, and columns
boroughs = ["manhattan", "brooklyn", "queens", "bronx", "statenisland"]
cols = ["BOROUGH", "NEIGHBORHOOD", "BUILDING CLASS CATEGORY",
       "TAX CLASS AT PRESENT", "BLOCK", "LOT", "EASEMENT",
       "BUILDING CLASS AT PRESENT", "ADDRESS", "APARTMENT NUMBER", "ZIP CODE",
       "RESIDENTIAL UNITS", "COMMERCIAL UNITS", "TOTAL UNITS",
       "LAND SQUARE FEET", "GROSS SQUARE FEET", "YEAR BUILT",
       "TAX CLASS AT TIME OF SALE", "BUILDING CLASS AT TIME OF SALE",
       "SALE PRICE", "SALE DATE"]

function get_file(borough, year)
    if borough == "statenisland"
        if year >= 2020
            borough = "staten_island"
        end
    end

    ext = year >= 2018 ? "xlsx" : "xls"
    link = "$url_prefix/annualized-sales/$year/$(year)_$borough.$ext"

    filename = download(link)
    data = XLSX.openxlsx(filename) do xf
        sheet_name = XLSX.sheetnames(xf)[1]
        DataFrame(XLSX.gettable(
            xf[sheet_name], "A:U"; 
            header=false, 
            column_labels=cols, 
            first_row=(year < 2020 ? 6 : 9), 
            infer_eltypes=true
            )
        )
    end
    println("$borough $year $(maximum(data[:, "SALE DATE"]))")

    return data
end

# Concatenate DataFrames
new_years = vcat([get_file(borough, year) for borough in boroughs, year in 2018:2022]...)
CSV.write("transactions/nyc_2018-2022.csv", new_years)


