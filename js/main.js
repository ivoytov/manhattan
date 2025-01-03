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
let outliers = []
let combinedData = []

const is_outlier = (obj) => !outliers.some(outlier => outlier.lot === obj.LOT && outlier.block === obj.BLOCK && outlier["SALE DATE"].getTime() === obj["SALE DATE"].getTime() && outlier.sale_price === obj["SALE PRICE"])

// Function to load CSV file using PapaParse
function loadTransactionDataCSV(url) {
  return new Promise((resolve, reject) => {
    Papa.parse(url, {
      header: true,
      download: true,
      skipEmptyLines: true,
      dynamicTyping: true,
      worker: false,
      step: row => {
        const dateKey = "SALE DATE"

        // Use destructuring to get other properties if needed
        const { [dateKey]: saleDate, ...rest } = row.data;

        // Convert string to Date, set to midnight (otherwise date filter doesn't work)
        const saleDateObj = new Date(saleDate);
        saleDateObj.setHours(24, 0, 0, 0)

        // Add other properties back if needed
        const cleanRow = { [dateKey]: saleDateObj, ...rest };

        // add outliers column to the data
        cleanRow.outlier = is_outlier(cleanRow)
        combinedData.push(cleanRow)
      },
      complete: () => {
        console.log("All done")
        resolve(true)
      },
      error: error => {
        reject(error.message);
      }
    });
  });
}


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
    maxWidth: 100,
  },
  {
    headerName: "Address", field: "ADDRESS", sort: "asc", sortIndex: 1,
    cellRenderer: 'agGroupCellRenderer',
    minWidth: 400,
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
    headerName: "BBL",
    type: "rightAligned",
    valueGetter: p => `${p.data.BLOCK}-${p.data.LOT}`,
    maxWidth: 100,
  },
  {
    headerName: "Apt #", field: "APARTMENT NUMBER",
    maxWidth: 100,
  },
  {
    headerName: "Total Units", field: "TOTAL UNITS",
    filter: 'agNumberColumnFilter',
    maxWidth: 100,
  },
  {
    headerName: "Year Built", field: "YEAR BUILT",
    filter: 'agNumberColumnFilter',
    maxWidth: 100,
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

function getTransactions(data) {
  let repeats = coopsFilter(data) ? combinedData.filter(({ ADDRESS }) => ADDRESS == data.ADDRESS)
  : combinedData.filter(({ BOROUGH, BLOCK, LOT }) => BOROUGH == data.BOROUGH && BLOCK == data.BLOCK && LOT == data.LOT)

  // remove erroneous transactions
  repeats = repeats.filter((transaction) => transaction["SALE PRICE"] >= 100000)
  return repeats
} 


const defaultColDef = {
  flex: 1,
  minWidth: 100,
  filter: 'agTextColumnFilter',
  menuTabs: ['filterMenuTab'],
  autoHeaderHeight: true,
  wrapHeaderText: false,
  sortable: true,
  resizable: true,
  suppressHeaderMenuButton: true,
}

// Initialize AG Grid
const gridOptions = {
  columnDefs: columnDefs,
  defaultColDef: defaultColDef,
  masterDetail: true,
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
      let repeats = getTransactions(params.data)
      repeats.sort((a, b) => a["SALE DATE"] - b["SALE DATE"])

     
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
const gridApi = agGrid.createGrid(gridDiv, gridOptions)

gridApi.setFilterModel(defaultFilter);

// URLs of the CSV files you want to load
const csvUrls = [
  'manhattan.csv',
  'bronx.csv',
  'brooklyn.csv',
  'queens.csv',
  'statenisland.csv',
  'nyc_2018-2022.csv',
];

// Array to store promises for each CSV file
const csvPromises = csvUrls.map(url => loadTransactionDataCSV(`transactions/${url}`));



// Use Promise.all to wait for all promises to resolve
loadCSV('transactions/outliers.csv').then((outs) => {
  outliers = outs
  return true
}).then((retValue) => {
  Promise.all(csvPromises)
    .then((resultsArray) => {
      // load the full table
      gridApi.setGridOption('rowData', combinedData)
      gridApi.sizeColumnsToFit()
    })
    .catch(error => {
      console.error('Error loading CSV files:', error);
    });
})


Promise.all([
  loadCSV("home_price_index.csv"),
  loadCSV("home_price_subindex.csv"),
  loadCSV("home_price_neighborhoods.csv")
])
  .then(([idx, idxb, idxn]) => {

    const boroughs = new Set(idxb.map(({ borough }) => borough))
    const houseClasses = new Set(idxb.map(({ house_class }) => house_class))
    const neighborhoods = new Set(idxn.map(({ neighborhood }) => neighborhood))

    const seriesNames = ["NYC", "NYC - Top 10%", "NYC - Top 33%", "NYC - Middle 33%", "NYC - Bottom 33%", "NYC - Bottom 10%"]
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
        series.push(makeSeries(data, name))
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
        series.push(makeSeries(data, name))
        seriesNames.push(name)
      }
    }

    const isSelected = seriesNames.reduce((accumulator, current) => {
      accumulator[current] = false;
      return accumulator;
    }, {})

    isSelected["Manhattan Condo"] = true
    isSelected["Brooklyn SFH"] = true
    isSelected["NYC"] = true
    isSelected["NYC - Top 10%"] = true

    // Specify the configuration items and data for the chart
    const option = {
      title: {
        text: 'NYC Repeat Sales Home Price Index'
      },
      dataset: [
        {
          dimensions: [{ name: 'period', type: 'time' }, "top_decile", "top_third", "bottom_decile", "middle_third", "bottom_third", "all"],
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
            y: 'all'
          }
        },
        {
          name: 'NYC - Top 10%',
          type: 'line',
          symbol: 'none',
          datasetIndex: 0,
          encode: {
            x: 'period',
            y: 'top_decile'
          }
        },
        {
          name: 'NYC - Top 33%',
          type: 'line',
          symbol: 'none',
          datasetIndex: 0,
          encode: {
            x: 'period',
            y: 'top_third'
          }
        },
        {
          name: 'NYC - Middle 33%',
          type: 'line',
          symbol: 'none',
          datasetIndex: 0,
          encode: {
            x: 'period',
            y: 'middle_third'
          }
        },
        {
          name: 'NYC - Bottom 33%',
          type: 'line',
          symbol: 'none',
          datasetIndex: 0,
          encode: {
            x: 'period',
            y: 'bottom_third'
          }
        },
        {
          name: 'NYC - Bottom 10%',
          type: 'line',
          symbol: 'none',
          datasetIndex: 0,
          encode: {
            x: 'period',
            y: 'bottom_decile'
          }
        },
        ...series
      ]
    };

    // Display the chart using the configuration items and data just specified.
    myChart.setOption(option);
  })

// Initialize the echarts instance based on the prepared dom
const myChart = echarts.init(document.getElementById('main'));

// splitter functionality
const splitter = document.getElementById('splitter')

let isResizing = false
const mapDiv = document.getElementById('main')

splitter.addEventListener('mousedown', startResize())
document.addEventListener('mousemove', resize())
document.addEventListener('mouseup', stopResize())

splitter.addEventListener('touchstart', startResize())
document.addEventListener('touchmove', resize())
document.addEventListener('touchend', stopResize())

function stopResize() {
  return () => {
    isResizing = false;
  };
}

function resize() {
  return (e) => {
    if (!isResizing) return;
    const lastY = e.type.includes('mouse') ? e.clientY : e.touches[0].clientY;
    const newMapHeight = lastY;
    const newGridHeight = window.innerHeight - lastY - splitter.offsetHeight;

    mapDiv.style.height = newMapHeight + 'px';
    gridDiv.style.height = newGridHeight + 'px';
    myChart.resize()
    gridApi.sizeColumnsToFit();

  };
}

function startResize() {
  return (e) => {
    isResizing = true;
  };
}

