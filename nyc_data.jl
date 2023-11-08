using XLSX, DataFrames, CSV, Dates
prefix_url(borough) = "https://www.nyc.gov/assets/finance/downloads/pdf/rolling_sales/rollingsales_$borough.xlsx"
boroughs = ["manhattan", "bronx", "brooklyn", "queens", "statenisland"]
earliest_date = Date(2022,12,31)

function process_borough(borough)
    filename = download(prefix_url(borough))
    new_df = XLSX.openxlsx(filename) do xf
        sheet_name = XLSX.sheetnames(xf)[1]
        DataFrame(XLSX.gettable(xf[sheet_name]; first_row=5, infer_eltypes=true))
    end

    # remove transactions before the last year
    new_df = new_df[new_df[!, "SALE DATE"] .> earliest_date, :] |> df -> sort(df, ["SALE DATE", "BLOCK", "LOT", "ADDRESS"])

    df = CSV.File("transactions/$borough.csv") |> DataFrame

    # Get list of existing sale dates
    existing_dates = Set(df[!, "SALE DATE"])

    # Filter new_df to rows with new dates
    new_rows = filter(row -> row["SALE DATE"] ∉ existing_dates, eachrow(new_df))

    # If there are new rows, append them to the CSV
    if length(new_rows) > 0
        CSV.write("transactions/$borough.csv", new_rows; append=true) 
    end
end

process_borough.(boroughs)