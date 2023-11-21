// Function to load CSV file using PapaParse
function loadCSV(url) {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      download: true,
      header: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      complete: results => {
        // Convert "SALE DATE" property to JavaScript Date objects
        results.data = results.data.map(obj => {
          const dateKey = "SALE DATE" in obj ? "SALE DATE" : "period"

          // Use destructuring to get other properties if needed
          const { [dateKey]: saleDate, ...rest } = obj;

          // Convert string to Date, set to midnight (otherwise date filter doesn't work)
          const saleDateObj = new Date(saleDate);
          saleDateObj.setHours(24, 0, 0, 0)

          // Add other properties back if needed
          return { [dateKey]: saleDateObj, ...rest };
        });


        resolve(results.data);
      },
      error: error => {
        reject(error.message);
      }
    });
  });
}

let combinedData

// Filter model
const defaultFilter = {
  "BUILDING CLASS CATEGORY": {
    filterType: 'text',
    type: 'condo',
  },
  "SALE PRICE": {
    filterType: 'number',
    type: 'greaterThan',
    filter: 100000
  }
}

// custom filter for BUILDING CLASS CATEGORY for SFH, Coops, Condos, Other
const houseClassFilterParams = {
  filterOptions: [
    'contains',
    {
      displayKey: 'condo',
      displayName: 'Condo',
      predicate: (_, cellValue) =>
        cellValue.slice(0, 2) == "12" || cellValue.slice(0, 2) == "13",
      numberOfInputs: 0,
    },
    {
      displayKey: 'Coop',
      displayName: 'Coop',
      predicate: (_, cellValue) =>
        cellValue.slice(0, 2) == "09" || cellValue.slice(0, 2) == "17",
      numberOfInputs: 0,
    },
    {
      displayKey: 'sfh',
      displayName: 'Single Family Home',
      predicate: (_, cellValue) =>
        cellValue.slice(0, 2) == "01",
      numberOfInputs: 0,
    },
    {
      displayKey: 'other',
      displayName: 'All Others',
      predicate: (_, cellValue) => {
        const code = cellValue.slice(0, 2)
        return !["01", "09", "10", "12", "13", "17"].includes(code)
      },
      numberOfInputs: 0,
    },
  ],
};

// grid columns
const columnDefs = [
  {
    headerName: "Is Included?",
    field: "outlier",
    cellDataType: 'boolean',
    filter: 'agSetColumnFilter',

  },
  {
    headerName: "Address", field: "ADDRESS", sort: "asc", sortIndex: 1,
    cellRenderer: 'agGroupCellRenderer',
    minWidth: 200,
  },
  {
    headerName: "Sale Date", field: "SALE DATE",
    suppressSizeToFit: true,
    minWidth: 120,
    filter: 'agDateColumnFilter',
    sort: "desc",
    sortIndex: 0
  },
  {
    headerName: "Borough",
    field: "BOROUGH",
    filter: 'agSetColumnFilter',
    valueGetter: (params) => {
      switch (params.data.BOROUGH) {
        case 1: return "Manhattan"
        case 2: return "Bronx"
        case 3: return "Brooklyn"
        case 4: return "Queens"
        case 5: return "Staten Island"
        default: return params.data.BOROUGH
      }
    }
  },
  {
    headerName: "Neighborhood", field: "NEIGHBORHOOD",
    filter: 'agSetColumnFilter'
  },
  {
    headerName: "Category", field: "BUILDING CLASS CATEGORY",
    filterParams: houseClassFilterParams,
  },
  {
    headerName: "Block", field: "BLOCK",
    filter: 'agNumberColumnFilter',
  },
  {
    headerName: "Lot", field: "LOT",
    filter: 'agNumberColumnFilter',
  },
  {
    headerName: "Apt #", field: "APARTMENT NUMBER"
  },
  {
    headerName: "Total Units", field: "TOTAL UNITS",
    filter: 'agNumberColumnFilter',
  },
  {
    headerName: "Land Sqft", field: "LAND SQUARE FEET",
    filter: 'agNumberColumnFilter',
  },
  {
    headerName: "Gross Sqft", field: "GROSS SQUARE FEET",
    filter: 'agNumberColumnFilter',
  },
  {
    headerName: "Year Built", field: "YEAR BUILT",
    filter: 'agNumberColumnFilter',
  },
  {
    headerName: "Sale Price",
    field: "SALE PRICE",
    filter: 'agNumberColumnFilter',
    valueFormatter: (params) => formattedCurrency.format(params.value)
  }
]

const formattedCurrency = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

const coopsFilter = (row) =>
  row['BUILDING CLASS CATEGORY'].startsWith('09')
  || row['BUILDING CLASS CATEGORY'].startsWith('10')
  || row['BUILDING CLASS CATEGORY'].startsWith('17')

const formattedPercent = new Intl.NumberFormat('en-US', {
  style: 'percent',
  minimumFractionDigits: 1,
  maximumFractionDigits: 1
})


const defaultColDef = {
  flex: 1,
  minWidth: 100,
  filter: 'agTextColumnFilter',
  menuTabs: ['filterMenuTab'],
  autoHeaderHeight: true,
  wrapHeaderText: true,
  sortable: true,
  resizable: true
}

// Initialize AG Grid
const gridOptions = {
  columnDefs: columnDefs,
  defaultColDef: defaultColDef,
  masterDetail: true,
  //detailRowHeight: 200,
  detailRowAutoHeight: true,

  detailCellRendererParams: {
    detailGridOptions: {
      columnDefs: [
        {
          field: 'SALE DATE',
          headerName: 'Sale Date',
          filter: 'agDateColumnFilter',
          sort: "asc",
          sortIndex: 0,
          sortable: true
        },
        {
          headerName: 'Sale Price',
          field: "SALE PRICE",
          valueFormatter: (params) => formattedCurrency.format(params.value),
        },
        {
          headerName: 'Change, $',
          field: "priceChange",
          filter: 'agNumberColumnFilter',
          valueFormatter: (params) => params.value != null ? formattedCurrency.format(params.value) : "N/A",
        },
        {
          headerName: 'Change, %',
          field: "priceChangePct",
          filter: 'agNumberColumnFilter',
          valueFormatter: (params) => params.value != null ? formattedPercent.format(params.value) : "N/A",
        },

      ],
      defaultColDef: {
        flex: 1,
        sortable: true,
        filter: 'agNumberColumnFilter',
      },
    },
    getDetailRowData: (params) => {
      // find all transactions for this address
      let repeats = coopsFilter(params.data) ? combinedData.filter(({ ADDRESS }) => ADDRESS == params.data.ADDRESS)
        : combinedData.filter(({ BOROUGH, BLOCK, LOT }) => BOROUGH == params.data.BOROUGH && BLOCK == params.data.BLOCK && LOT == params.data.LOT)
      repeats.sort((a, b) => a["SALE DATE"] - b["SALE DATE"])

      // remove erroneous transactions
      repeats = repeats.filter((transaction) => transaction["SALE PRICE"] >= 100000)

      // add % price change
      repeats = repeats.map((transaction, index, arr) => {
        // For the first row, priceChange is null
        if (index === 0) {
          return { ...transaction, priceChange: null };
        }

        // For subsequent rows, priceChange is the difference in price over the immediately preceding sale
        const priceChange = transaction["SALE PRICE"] - arr[index - 1]["SALE PRICE"];
        const priceChangePct = transaction["SALE PRICE"] / arr[index - 1]["SALE PRICE"] - 1;
        return { ...transaction, priceChange, priceChangePct };
      });

      params.successCallback(repeats);
    },
  },
};

// Create AG Grid
const gridDiv = document.querySelector('#myGrid');
new agGrid.Grid(gridDiv, gridOptions);

gridOptions.api.setFilterModel(defaultFilter);

// URLs of the CSV files you want to load
const csvUrls = [
  'outliers.csv',
  'manhattan.csv',
  'bronx.csv',
  'brooklyn.csv',
  'queens.csv',
  'statenisland.csv',
  'nyc_2018-2022.csv',
];

// Array to store promises for each CSV file
const csvPromises = csvUrls.map(url => loadCSV(`transactions/${url}`));



// Use Promise.all to wait for all promises to resolve
Promise.all(csvPromises)
  .then(([outliers, ...resultsArray]) => {
    // Combine the results from all CSV files
    combinedData = resultsArray.reduce((acc, data) => acc.concat(data), []);

    // add outliers column to the data
    const is_outlier = (obj) => {
      return {
        ...obj,
        outlier: !outliers.some(outlier => outlier.lot === obj.LOT && outlier.block === obj.BLOCK && outlier["SALE DATE"].getTime() === obj["SALE DATE"].getTime() && outlier.sale_price === obj["SALE PRICE"])
      }
    }
    combinedData = combinedData.map(is_outlier)


    gridOptions.api.setRowData(combinedData)
    gridOptions.api.sizeColumnsToFit()
  })
  .catch(error => {
    console.error('Error loading CSV files:', error);
  });

Promise.all([
  loadCSV("home_price_index.csv"),
  loadCSV("home_price_subindex.csv"),
  loadCSV("home_price_neighborhoods.csv")
])
  .then(([idx, idxb, idxn]) => {

    const boroughs = new Set(idxb.map(({ borough }) => borough))
    const houseClasses = new Set(idxb.map(({ house_class }) => house_class))
    const neighborhoods = new Set(idxn.map(({ neighborhood }) => neighborhood))

    const seriesNames = []
    const series = []
    const makeSeries = (data, name) => {
      return {
        name: name,
        type: 'line',
        symbol: 'none',
        data: data
      }
    }
    for (const borough of boroughs) {
      for (const cls of houseClasses) {
        const data = idxb.filter(({ borough: b, house_class: c }) => borough == b & cls == c)
          .map(({ period, home_price_index }) => [period, home_price_index])
        const name = `${borough} ${cls}`
        series.push(makeSeries(data,name))
        seriesNames.push(name)
      }
    }

    for (const borough of boroughs) {
      for (const neighborhood of neighborhoods) {
        const data = idxn.filter(({ borough: b, neighborhood: n }) => borough == b & neighborhood == n)
          .map(({ period, home_price_index }) => [period, home_price_index])
        const name = `${borough} ${neighborhood}`

        // since not every neighborhood is in every borough, eliminate the empty ones
        if (!data.length) {
          continue
        }
        series.push(makeSeries(data,name))
        seriesNames.push(name)
      }
    }

    const isSelected = seriesNames.reduce((accumulator, current) => {
      accumulator[current] = false;
      return accumulator;
    }, {})

    isSelected["Manhattan Condo"] = true
    isSelected["Brooklyn SFH"] = true

    // Specify the configuration items and data for the chart
    const option = {
      title: {
        text: 'NYC Repeat Sales Home Price Index'
      },
      dataset: [
        {
          dimensions: [{ name: 'period', type: 'time' }, 'home_price_index'],
          source: idx,
        },
      ],
      tooltip: {
        trigger: 'axis'
      },
      legend: {
        selected: isSelected,
        type: 'scroll',
        orient: 'horizontal',
        data: seriesNames,
        top: 20,
        left: 20,
        right: 20,
        textStyle: {
          width: 75,
          overflow: 'break'

        }
      },
      grid: {
        top: 100
      },
      xAxis: {
        type: 'time'
      },
      yAxis: {
        min: 'dataMin',
      },
      series: [
        {
          name: 'NYC',
          type: 'line',
          symbol: 'none',
          datasetIndex: 0,
          encode: {
            x: 'period',
            y: 'home_price_index'
          }
        },
        ...series
      ]
    };

    // Display the chart using the configuration items and data just specified.
    myChart.setOption(option);
  })

// Initialize the echarts instance based on the prepared dom
var myChart = echarts.init(document.getElementById('main'));

