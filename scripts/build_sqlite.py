from pathlib import Path

import polars as pl


PROJECT_ROOT = Path(__file__).resolve().parents[1]
TRANSACTIONS_DIR = PROJECT_ROOT / "transactions"
SQLITE_PATH = TRANSACTIONS_DIR / "data" / "nyc_data.sqlite"

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
        "TAX CLASS AT PRESENT",
        "BLOCK",
        "LOT",
        "EASEMENT",
        "BUILDING CLASS AT PRESENT",
        "ADDRESS",
        "APARTMENT NUMBER",
        "ZIP CODE",
        "RESIDENTIAL UNITS",
        "COMMERCIAL UNITS",
        "TOTAL UNITS",
        "LAND SQUARE FEET",
        "GROSS SQUARE FEET",
        "YEAR BUILT",
        "TAX CLASS AT TIME OF SALE",
        "BUILDING CLASS AT TIME OF SALE",
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

    df = pl.concat(lazy_frames).collect()

    dimension_tables = {}
    final_columns = []

    for column in cols:
        if column in DIMENSION_CONFIGS:
            config = DIMENSION_CONFIGS[column]
            dim_df = (
                df.select(pl.col(column))
                .unique()
                .sort(column)
                .with_row_index(name="id", offset=1)
            )

            df = (
                df.join(dim_df, on=column, how="left")
                .rename({"id": config["id_column"]})
                .drop(column)
            )

            dimension_tables[config["table_name"]] = dim_df.rename(
                {column: config["value_column"]}
            )
            final_columns.append(config["id_column"])
        else:
            final_columns.append(column)

    df = df.select(final_columns)

    df.write_database(
        "transactions",
        f"sqlite:///{SQLITE_PATH.resolve()}",
        if_table_exists="replace",
        engine="adbc",
    )

    for table_name, table_df in dimension_tables.items():
        table_df.write_database(
            table_name,
            f"sqlite:///{SQLITE_PATH.resolve()}",
            if_table_exists="replace",
            engine="adbc",
        )


if __name__ == "__main__":
    build_database()
