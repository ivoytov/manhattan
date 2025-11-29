from pathlib import Path

import polars as pl


PROJECT_ROOT = Path(__file__).resolve().parents[1]
TRANSACTIONS_DIR = PROJECT_ROOT / "transactions"
SQLITE_PATH = PROJECT_ROOT / "data" / "nyc_data.sqlite"

DIMENSION_CONFIGS = {
    "NEIGHBORHOOD": {
        "table_name": "neighborhoods",
        "value_column": "neighborhood",
        "id_column": "neighborhood_id",
    },
    "BUILDING CLASS CATEGORY": {
        "table_name": "building_class_categories",
        "value_column": "building_class_category",
        "id_column": "building_class_category_id",
    },
}


def build_database():
    cols = [
        "BOROUGH",
        "NEIGHBORHOOD",
        "BUILDING CLASS CATEGORY",
        # "TAX CLASS AT PRESENT",
        "BLOCK",
        "LOT",
        # "EASEMENT",
        # "BUILDING CLASS AT PRESENT",
        "ADDRESS",
        "APARTMENT NUMBER",
        "ZIP CODE",
        "RESIDENTIAL UNITS",
        "COMMERCIAL UNITS",
        "TOTAL UNITS",
        "LAND SQUARE FEET",
        "GROSS SQUARE FEET",
        "YEAR BUILT",
        # "TAX CLASS AT TIME OF SALE",
        # "BUILDING CLASS AT TIME OF SALE",
        "SALE PRICE",
        "SALE DATE",
    ]

    lazy_frames = []
    for csv_path in sorted(TRANSACTIONS_DIR.glob("*.csv")):
        lf = pl.scan_csv(csv_path, schema_overrides={"SALE DATE": pl.Date})
        missing = [column for column in cols if column not in lf.collect_schema().names()]
        if missing:
            raise ValueError(f"{csv_path.name} is missing expected columns: {missing}")

        # Keep only the columns we care about; some legacy files include an extra SALE YEAR column.
        lazy_frames.append(lf.select([pl.col(column) for column in cols]))

    if not lazy_frames:
        raise RuntimeError(f"No CSV files found in {TRANSACTIONS_DIR}")

    df = pl.concat(lazy_frames).filter(pl.col("SALE DATE").dt.year() > 2015).collect()

    dimension_tables = {}
    final_columns = []

    for column in cols:
        if column in DIMENSION_CONFIGS:
            config = DIMENSION_CONFIGS[column]
            dim_df = (
                df.select(pl.col(column).str.to_titlecase())
                .unique()
                .sort(column)
                .with_row_index(name="id", offset=1)
            )

            df = (
                df.join(dim_df, on=pl.col(column).str.to_titlecase(), how="left")
                .rename({"id": config["id_column"]})
                .drop(column)
            )

            dimension_tables[config["table_name"]] = dim_df.rename(
                {column: config["value_column"]}
            )
            final_columns.append(config["id_column"])
        else:
            final_columns.append(column)


    addresses = df.sort('SALE DATE').group_by('BOROUGH', 'BLOCK', 'LOT').agg(pl.format("{}{}", pl.col.ADDRESS, (pl.lit(", ") + pl.col('APARTMENT NUMBER')).fill_null("")).last())
    df = df.select(final_columns)#.drop('ADDRESS', 'APARTMENT NUMBER')

    # Ensure the output directory exists before attempting to open the database file.
    SQLITE_PATH.parent.mkdir(parents=True, exist_ok=True)

    df.write_database(
        "transactions",
        f"sqlite:///{SQLITE_PATH.resolve()}",
        if_table_exists="replace",
        engine="adbc",
    )

    # addresses.write_database(
    #     "addresses",
    #     f"sqlite:///{SQLITE_PATH.resolve()}",
    #     if_table_exists="replace",
    #     engine="adbc",
    # )

    for table_name, table_df in dimension_tables.items():
        table_df.write_database(
            table_name,
            f"sqlite:///{SQLITE_PATH.resolve()}",
            if_table_exists="replace",
            engine="adbc",
        )

    boroughs = pl.DataFrame({ "id": range(1,6), "borough": [ "Manhattan", "Bronx", "Brooklyn", "Queens", "Staten Island"] })        
    boroughs.write_database("boroughs", f"sqlite:///{SQLITE_PATH.resolve()}", if_table_exists="replace", engine="adbc",)

    house_classes = pl.DataFrame({ "id": range(3), "house_class": ["Condo", "Coop", "SFH" ] })
    house_classes.write_database("house_classes", f"sqlite:///{SQLITE_PATH.resolve()}", if_table_exists="replace", engine="adbc",)


    indices = ['index', 'neighborhoods', 'subindex']
    for idx in indices:
        idx_df = pl.read_csv(f"home_price_{idx}.csv")

        if idx != "index":
            idx_df = idx_df.join(boroughs, on='borough').drop('borough').rename({'id': 'borough_id'})

        if idx == 'neighborhoods':
            idx_df = idx_df.join(dimension_tables['neighborhoods'], on=pl.col('neighborhood').str.to_titlecase(), coalesce=True).drop('neighborhood', 'neighborhood_right').rename({'id': 'neighborhood_id'})
        
        if idx == "subindex":
            idx_df = idx_df.join(house_classes, on='house_class').drop('house_class').rename({'id': 'house_class_id'})

        idx_df.write_database(
            f"home_price_{idx}",
            f"sqlite:///{SQLITE_PATH.resolve()}",
            if_table_exists="replace",
            engine="adbc",
        )


if __name__ == "__main__":
    build_database()
