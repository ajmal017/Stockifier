const db = require('./js/database')
const electron = require('electron')
const Chart = require('chart.js')
const BrowserWindow = electron.remote.BrowserWindow
const path = require('path')





if (window.localStorage.getItem("apiKey") != null) {
    window.stockapi = require('./js/stockapi');
}


var stockMatches = []; //Global variable for stock matches
var substringMatcher = function () {
    return function findMatches(string, syncWait, cb) {
        stockapi.searchStock(string, (data) => {
            try {
                let d = (JSON.parse(data)).bestMatches;
                let results = []
                d.forEach(element => {
                    results.push(element['2. name'] + ' (' + element['1. symbol'] + ')')
                });
                window.stockMatches = results;

            } catch (error) {
                //do nothing
            }
            finally {
                console.log(string);
                cb(stockMatches);
            }
        })

    };
};


function deleteNotification(notifID) {
    let conn = db.conn;
    conn.run("DELETE FROM Notifications WHERE ID=?", notifID, (err) => {
        if (err) {
            console.log(err);
        }
        console.log("Deleted");
    });
    loadNotifications(false);
}
function sendNotification(title, body) {
    Notification.requestPermission().then(() => {
        var myNotification = new Notification(title, {
            body: body
        });
    })
}
function reloadWin(params) {
    electron.remote.getCurrentWindow().reload();
}

function showNotificationWindow() {
    let options = {
        width: 650,
        height: 550
    };
    let notifWinPath = path.join("file://", __dirname, "/notify.html")
    let notifWin = new BrowserWindow(options)
    notifWin.on('close', () => notifWin = null)
    notifWin.loadURL(notifWinPath)
    notifWin.show()
}

function checkTarget(symbol, targetVal, direction, callback) {
    stockapi.getStockQuote(symbol, (currVal) => {
        if (direction == "up") {
            if (targetVal >= currVal) {
                callback(true);
                return;
            }
        }
        else {
            if (targetVal <= currVal) {
                callback(true);
                return;
            }
        }
        callback(false);
    })
}

function setApiKey() {
    $key = $('#txtApiKey').val();
    window.localStorage.apiKey = $key;
    reloadWin();
}

/* Obtain AlphaVantage API Key */
function openAPIWin() {
    electron.shell.openExternal("https://www.alphavantage.co/support/#api-key");
    return false;
}

function loadNotifications(enabled) {
    let conn = db.conn;

    get_notifications_qry = "SELECT Count(*) as count FROM Notifications";
    conn.get(get_notifications_qry, (err, row) => {

        $('#notificationNumber').html(row.count);
        $('#notificationCount').html(row.count);
        if (row.count > 0) {
            $('#notificationNumber').removeClass('d-none');
            if (enabled) sendNotification("Stockifier", "You have new Notifications!");
            $notifView = $('#notificationList');
            $notifView.html('');
            get_notifications_qry = "SELECT * FROM Notifications";
            conn.each(get_notifications_qry, (err, row) => {
                if (err) {
                    console.log(err);
                    return;
                }

                $notifView.append(`
                        <li class="toast" role="alert" aria-live="assertive" aria-atomic="true" data-autohide="false">
                            <div class="toast-header d-flex">
                                <i class="material-icons">
                                    info
                                </i>
                                <strong class="mr-auto">`+ row.Title + `</strong>
                                <small class="text-muted">`+ row.Created_On + `</small>
                                <button type="button" class="ml-2 mb-1 close" data-dismiss="toast"
                                    aria-label="Close">
                                    <span onclick='deleteNotification(` + row.ID + `)'>&times;</span>
                                </button>
                            </div>
                            <div class="toast-body">
                                `+ row.Content + `
                            </div>
            
                        </li>
                        
                        `);
                $('.toast').toast('show');
            });


        }
        else {
            $('#notificationNumber').addClass('d-none');
        }

    });


}

function initalizeAlerts() {
    let conn = db.conn;
    let i = 0;
    let notifQry = "INSERT INTO Notifications (Type,Title,Content,StockID) VALUES (?,?,?,?)";
    let direction = "falling";
    conn.each("SELECT a.ID as AlertID,a.*,s.* FROM Alerts a,Stocks s WHERE a.StockID=s.ID", (err, row) => {

        if (row['direction'] == "up") {
            direction = "rising";
        }
        console.log(row);
        var notif = setInterval(() => {

            console.log(notif);
            checkTarget(row['Index'], row['TargetPrice'], row['Direction'], (beat) => {
                console.log(row['ID'] + "ok" + beat);
                if (beat) {
                    conn.run(notifQry, ['normal', "Stockifier - " + row['Index'], row['StockName'] + " beat your target value of " + row['TargetPrice'] + " while " + direction, row['StockID']], (err) => {
                        //Inserting into notification
                        console.log(err);
                    });
                    sendNotification("Stockifier - " + row['Index'], row['StockName'] + " beat your target value of " + row['TargetPrice']);
                    loadNotifications(false);
                    if (row['Auto_Renew'] == 0) {
                        // Delete Alert when notified
                        clearInterval(notif);
                        conn.run("DELETE FROM Alerts WHERE ID=?", row['AlertID'], (err) => {
                            console.log(err);
                        });
                    }
                    else {
                        if (row['direction'] == "up") {
                            conn.run("UPDATE Alerts SET TargetPrice=TargetPrice+2 WHERE ID=?", row['AlertID'], (err) => {
                                console.log(err);
                            });
                        }
                        else {
                            conn.run("UPDATE Alerts SET TargetPrice=TargetPrice-2 WHERE ID=?", row['AlertID'], (err) => {
                                console.log(err);
                            });
                        }
                    }
                }

            });
        }, row['frequency'] * 1000 + i); //Frequency in minutes plus some seconds to avoid API error
        i += 10000;
    });
}

//initalizeAlerts();

function normalize(val, min, max) {
    return (val - min) / (max - min);
}
function loadSpotlight(element, stockID) {

    $current = $('.stockSelected');
    $current.removeClass('stockSelected');
    $(element).addClass('stockSelected');


    let conn = db.conn;
    conn.get('SELECT * FROM Stocks WHERE "Index"=?', stockID, (err, row) => {
        myChart.options.title.text = row.StockName;
    });
    stockapi.getStockData(stockID, (data) => {


        let keys = Object.keys(data);
        keys = keys.reverse()
        let dates = [];
        let time_series_points = [];
        let volumes = [];
        let i = 0
        for (const key of keys) {
            if (i % 5 == 0) {
                dates.push(String(keys[i]).split(' ')[1].split(':'));
                time_series_points.push(Number(data[key]['4. close']));
                volumes.push(Number(data[key]['5. volume']));
            }
            i += 1;
        }
        dates = dates.map((el) => el[0] + ":" + el[1]);


        /* Dynamic updation of chart */
        myChart.data.labels = dates;
        myChart.data.datasets[0].data = time_series_points;
        myChart.data.datasets[1].data = volumes;
        myChart.update();

    });
}
//loadSpotlight(this, 'TCS.NSE');


/* Initialize chart */
var ctx = $("#myChart");
var myChart = new Chart(ctx, {
    type: 'bar',
    data: {
        type: 'bar',
        datasets: [{
            type: 'line',
            label: 'Stock Price',
            fill: false,
            data: [],
            borderWidth: 2,
            borderColor: 'rgba(196, 22, 98,1)',
            backgroundColor: 'rgba(196, 22, 98,1)',
            pointRadius: 3,
            yAxisID: 'price'
        }, {
            type: 'bar',
            label: 'Volume',
            fill: false,
            data: [],
            backgroundColor: 'rgba(190, 135, 211,0.4)',
            yAxisID: 'volume'
        }]
    },
    options: {
        responsive: true,
        title: {
            display: true,
            text: 'Select a Stock to view performance'
        },
        scales: {
            xAxes: [{
                gridLines: {
                    display: false
                }
            }],
            yAxes: [{
                type: 'linear',
                position: 'left',
                id: 'price',
                gridLines: {
                    display: false
                }
            }, {
                type: 'linear',
                position: 'right',
                id: 'volume',
                gridLines: {
                    display: false
                }
            }]
        }
    }
});


$("#menu-toggle").click(function (e) {
    e.preventDefault();
    setTimeout(() => {
        myChart.resize();

    }, 1000);
    $("#wrapper").toggleClass("toggled");
});



$(document).ready(function () {





    $('.dropdown-menu').click(function (e) {
        e.stopPropagation();
    });
    $('#btnAddStock').on('click', () => {

        $('.dropdown').dropdown("toggle");
        val = $('#typeahead').val();
        if (val.includes('(') && val.includes(')')) {
            stIndex = val.split('(')[1];
            stIndex = stIndex.split(')')[0];
            val = val.split('(')[0];
            val = val.split(' ').splice(0, 1).join(" ");
            let conn = db.initDB();
            console.log(val);
            try {

                stockapi.searchStock(val, (data) => {
                    console.log(String(data));
                    try {
                        data = JSON.parse(data).bestMatches;

                    } catch (error) {
                        openSnackbar("An error occured");
                        return;
                    }
                    console.log(data);
                    for (let index = 0; index < data.length; index++) {
                        const element = data[index];

                        if (element['1. symbol'] == stIndex) {

                            insertStockQry = "INSERT INTO Stocks ('Stockname','Index','High','Low','Currency') VALUES ('" + element['2. name'] + "','" + stIndex + "',0,0,'" + element['8. currency'] + "')"
                            console.log(insertStockQry);
                            conn.run(insertStockQry, (err) => {
                                if (err) console.log(err);

                                openSnackbar("Stock Added!");
                                initializeStockView();

                            });
                            break;
                        }
                    }

                });

            } catch (error) {
                alert("An error occured!" + error);
            }
        }
        else {
            try {
                val = val.split(' ').splice(0, 1).join(" ");
                console.log(val);
                stockapi.searchStock(val, (data) => {
                    console.log(String(data));

                    try {
                        data = JSON.parse(data).bestMatches;

                    } catch (error) {
                        openSnackbar("An error occured");
                        return;
                    }
                    data = data[0];

                    insertStockQry = "INSERT INTO Stocks ('Stockname','Index','High','Low','Currency') VALUES ('" + data['2. name'] + "','" + data['1. symbol'] + "',0,0,'" + data['8. currency'] + "')"
                    console.log(insertStockQry);
                    conn.run(insertStockQry, (err) => {
                        if (err) console.log(err);

                        openSnackbar("Stock Added!");
                        initializeStockView();

                    });
                });
            } catch (error) {
                alert("An error occured!" + error);
            }
        }
        //console.log(val);

    });

    /* Typeahead instance */
    $('#the-basics .typeahead').typeahead({
        hint: true,
        highlight: true,
        minLength: 3

    },
        {
            name: 'stocks',
            source: substringMatcher()
        });

    /* Initialize ripple for all buttons */
    const buttons = document.querySelectorAll('button');
    for (const button of buttons) {
        mdc.ripple.MDCRipple.attachTo(button);
    }
    const textfields = document.querySelectorAll('.mdc-text-field');
    for (const tf of textfields) {
        mdc.textField.MDCTextField.attachTo(tf);
    }

    const apidialog = mdc.dialog.MDCDialog.attachTo(document.querySelector('#apikeyDialog'));
    $('#btnOpenKeyDialog').on('click', () => {
        apidialog.open();
    })
    if (window.localStorage.getItem("apiKey") == null) {
        apidialog.open();
    }



    /* Alert Dialog */
    const dialog = mdc.dialog.MDCDialog.attachTo(document.querySelector('.mdc-dialog-deletediag'));

    function openDeleteDialog(dialogTitle, dialogMsg, deleteID) {
        $dialogTitle = $("#my-dialog-title");
        $dialogmsg = $('#my-dialog-content');
        $dialogTitle.text(dialogTitle);
        $dialogmsg.text(dialogMsg);
        dialog.open();

        dialog.listen('MDCDialog:closing', (action) => {
            let actionSel = action.detail.action;
            let conn = db.conn;
            if (actionSel == "yes") {
                delStockQry = "DELETE FROM Stocks WHERE ID=?";
                conn.run(delStockQry, deleteID, (err) => {
                    if (err) {
                        return openSnackbar("Unable to delete!");
                    }
                    openSnackbar("Deleted successfully!");
                    initializeStockView();
                });
            }
        })
    }
    /* Function to handle stockDelete */
    $(document).on('click', ".btnDeleteStock", function () {
        openDeleteDialog("Delete Stock", "Are you sure you want to delete the stock?", $(this).attr('data-delete-id'));
    });

    const sb = mdc.snackbar.MDCSnackbar.attachTo(document.querySelector('.mdc-snackbar'));
    function openSnackbar(snackbarMsg) {
        $snackbar = $("#snackbar-msg");
        $snackbar.text(snackbarMsg);
        sb.open();
        setTimeout(() => {
            sb.close()
        }, 5000);

    }

    /* Initialize stocks view */
    function initializeStockView() {
        let conn = db.initDB();
        console.log(conn);
        $stocksList = $('#myStocks');
        $stocksList.html('');
        conn.get("SELECT COUNT(*) as count FROM Stocks", (err, row) => {
            if (row.count > 0) {
                conn.each("SELECT ID,\"Index\",StockName,High,Low FROM Stocks", function (err, row) {
                    $stocksList.append(`
            
                                <li
                                    class="list-group-item list-group-item-action justify-content-center align-items-center" onclick='loadSpotlight(this,"`+ row.Index + `")'>
                                    <div class="mr-auto p-2" id="stockTitle"><b>`+ row.Index + `</b>
                                        <div class="badge badge-success badge-pill p-2 float-right">High: `+ row.High + `</div>
                                        <br>
                                        <span id="stockTitle">`+ row.StockName + `</span>
                                    </div>
                                    <div class="p-2 d-flex justify-content-around">
                                        <button class="mdc-fab mdc-fab--mini mdc-fab--extended notify" data-notify-id=`+ row.ID + `>
                                            <span class="mdc-fab__icon material-icons">notifications_active</span>
                                            <span class="mdc-fab__label">Notify</span>
                                        </button>
                                        <button class="mdc-fab mdc-fab--mini delete mdc-fab--extended btnDeleteStock"
                                            data-delete-id=`+ row.ID + `>
                                            <span class="mdc-fab__icon material-icons">delete</span>
                                            <span class="mdc-fab__label">Delete</span>

                                        </button>
                                    </div>
                                </li>
                    `);

                });
            }
            else {
                $stocksList.html(`
            
                    <li class="list-group-item justify-content-center align-items-center">
                        No stocks found!
                    </li>
                    `);
            }
        })

    }
    initializeStockView();



    loadNotifications(true);



    $("#txtStockSearch").on("keyup", function () {
        var value = $(this).val().toLowerCase();
        console.log(value)
        $("#myStocks li").filter(function () {
            $(this).toggle($(this).text().toLowerCase().indexOf(value) > -1)
        });
    });
});
