using DataFrames
using XLSX, ExcelReaders

# Define URL prefixes
url_prefix = "https://www.nyc.gov/assets/finance/downloads/pdf/rolling_sales"

# Define years, boroughs, and columns
boroughs = ["manhattan", "brooklyn", "queens", "bronx", "statenisland"]
cols = ["BOROUGH", "NEIGHBORHOOD", "BUILDING CLASS CATEGORY",
       "TAX CLASS AT PRESENT", "BLOCK", "LOT", "EASE-MENT",
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
    data = missing
    if ext == "xls"
        xf = openxl(filename)
        sheet_name = xf.workbook.sheet_names()[1]
        data = DataFrame(readxlsheet(filename, sheet_name; skipstartrows=5), cols)
    else

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
    end
    println("$borough $year $(maximum(data[:, "SALE DATE"]))")

    return data
end

function get_legacy_file(borough)
    links = [
        "$url_prefix_pre_2021/annualized-sales/2009_$borough.xls",
        "https://www1.nyc.gov/assets/finance/downloads/pdf/09pdf/rolling_sales/sales_2008_$borough.xls",
        "https://www1.nyc.gov/assets/finance/downloads/excel/rolling_sales/sales_2007_$borough.xls",
        ["https://www1.nyc.gov/assets/finance/downloads/sales_$(borough != "statenisland" ? borough : "si")_0$n.xls" for n in 3:6]...
    ]

    return vcat([ExcelFiles.read(link, skip=4, column_labels=cols, dateformat="yyy-mm-dd") for link in links]...)
end

# Concatenate DataFrames
new_years = vcat([get_file(borough, year) for borough in boroughs, year in 2018:2022]...)
CSV.write("transactions/transactions_2018-2022.csv", new_years)

xls_years = vcat([get_file(borough, year) for borough in boroughs, year in 2010:2018]...)

# old_years = vcat([get_legacy_file(borough) for borough in boroughs]...)

