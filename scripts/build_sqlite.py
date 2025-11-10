#!/usr/bin/env python3
"""
Utility script to bundle all project CSV datasets into a single SQLite database.

The generated database is intended to be consumed from the browser via sql.js
(SQLite compiled to WebAssembly). Each CSV file is converted into a table whose
name is derived from the file path (e.g. transactions/manhattan.csv ->
transactions_manhattan). Column names are preserved. Basic type inference is
applied so that numeric columns remain numeric inside SQLite.
"""

from __future__ import annotations

import argparse
import csv
import re
import sqlite3
from pathlib import Path
from typing import Dict, Iterable, List, Tuple

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "data" / "nyc_data.sqlite"

# Tables that share the canonical transactions schema and should be exposed via
# the transactions_combined view (mirrors the CSVs previously used in JS).
TRANSACTION_TABLES_FOR_VIEW = [
    "transactions_manhattan",
    "transactions_bronx",
    "transactions_brooklyn",
    "transactions_queens",
    "transactions_statenisland",
    "transactions_nyc_2018_2022",
]


def find_csv_files() -> Iterable[Path]:
    """Yield all CSV files under the project root excluding node_modules."""
    for path in sorted(ROOT.rglob("*.csv")):
        if any(part in path.parts for part in ("node_modules", ".venv", ".git")):
            continue
        yield path


def table_name_for(path: Path) -> str:
    """Derive a safe SQLite table name from the CSV path."""
    rel = path.relative_to(ROOT)
    without_suffix = rel.with_suffix("")
    # Replace any non-alphanumeric character with an underscore and collapse repeats.
    sanitized = re.sub(r"[^0-9a-zA-Z]+", "_", without_suffix.as_posix())
    return sanitized.strip("_").lower()


def infer_column_types(rows: List[Dict[str, str]], columns: List[str]) -> Dict[str, str]:
    """
    Infer SQLite column affinities (INTEGER, REAL, TEXT) from the CSV rows.
    Empty values are treated as NULLs.
    """
    types = {column: "INTEGER" for column in columns}

    for row in rows:
        for column in columns:
            value = row[column]
            if value in ("", None):
                continue

            current = types[column]
            if current == "TEXT":
                continue

            if current == "INTEGER":
                if _is_int(value):
                    continue
                elif _is_float(value):
                    types[column] = "REAL"
                else:
                    types[column] = "TEXT"
            elif current == "REAL":
                if not _is_float(value):
                    types[column] = "TEXT"

    return types


def _is_int(value: str) -> bool:
    try:
        int(value)
        return True
    except (TypeError, ValueError):
        return False


def _is_float(value: str) -> bool:
    try:
        float(value)
        return True
    except (TypeError, ValueError):
        return False


def convert_value(value: str | None, column_type: str):
    if value in ("", None):
        return None
    if column_type == "INTEGER":
        return int(value)
    if column_type == "REAL":
        return float(value)
    return value


def load_csv(path: Path) -> Tuple[List[str], List[Dict[str, str]]]:
    try:
        return _load_csv_with_encoding(path, "utf-8-sig")
    except UnicodeDecodeError:
        return _load_csv_with_encoding(path, "latin-1")


def _load_csv_with_encoding(path: Path, encoding: str) -> Tuple[List[str], List[Dict[str, str]]]:
    with path.open(newline="", encoding=encoding) as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames is None:
            raise ValueError(f"{path} is missing a header row.")

        columns = reader.fieldnames
        rows = []
        for row in reader:
            cleaned = {
                column: (row[column].strip() if row[column] is not None else "")
                for column in columns
            }
            rows.append(cleaned)

    return columns, rows


def create_table(conn: sqlite3.Connection, table: str,
                 columns: List[str], column_types: Dict[str, str],
                 rows: List[Dict[str, str]]) -> None:
    quoted_columns = [f'"{column}" {column_types[column]}' for column in columns]
    conn.execute(f'DROP TABLE IF EXISTS "{table}"')
    conn.execute(f'CREATE TABLE "{table}" ({", ".join(quoted_columns)})')

    column_list = ", ".join(f'"{column}"' for column in columns)
    placeholders = ", ".join(["?"] * len(columns))
    insert_sql = f'INSERT INTO "{table}" ({column_list}) VALUES ({placeholders})'

    to_insert = [
        tuple(convert_value(row[column], column_types[column]) for column in columns)
        for row in rows
    ]

    conn.executemany(insert_sql, to_insert)


def build_database(database_path: Path) -> None:
    database_path.parent.mkdir(parents=True, exist_ok=True)

    with sqlite3.connect(database_path) as conn:
        conn.execute("PRAGMA foreign_keys = OFF")  # not needed but ensures clean recreation

        csv_files = list(find_csv_files())
        if not csv_files:
            raise SystemExit("No CSV files found to import.")

        for csv_path in csv_files:
            table = table_name_for(csv_path)
            relative = csv_path.relative_to(ROOT)
            print(f"Importing {relative} -> {table}")
            columns, rows = load_csv(csv_path)
            column_types = infer_column_types(rows, columns)
            create_table(conn, table, columns, column_types, rows)

        # Recreate the convenience view used by the web UI.
        conn.execute('DROP VIEW IF EXISTS "transactions_combined"')
        missing_tables = [table for table in TRANSACTION_TABLES_FOR_VIEW
                          if not _table_exists(conn, table)]
        if missing_tables:
            raise SystemExit(f"Expected tables missing for transactions view: {', '.join(missing_tables)}")

        union_query = " UNION ALL ".join(
            f'SELECT * FROM "{table}"' for table in TRANSACTION_TABLES_FOR_VIEW
        )
        conn.execute(f'CREATE VIEW "transactions_combined" AS {union_query}')

        conn.commit()


def _table_exists(conn: sqlite3.Connection, table: str) -> bool:
    cursor = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type IN ('table', 'view') AND name = ?",
        (table,),
    )
    return cursor.fetchone() is not None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Bundle project CSV files into a SQLite database.")
    parser.add_argument(
        "--database",
        type=Path,
        default=DEFAULT_DB,
        help=f"Output SQLite file (default: {DEFAULT_DB.relative_to(ROOT)})",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    build_database(args.database.resolve())


if __name__ == "__main__":
    main()
