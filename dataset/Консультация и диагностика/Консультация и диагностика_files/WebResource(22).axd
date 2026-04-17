
StiMvcViewer.prototype.InitializeDatePicker = function (datePicker) {
    datePicker.jsObject = this;
    this.options.datePicker = datePicker;
    datePicker.monthesNames = datePicker.getAttribute("monthes").split(",");
    datePicker.nextMonthButton = document.getElementById(datePicker.id + "NextMonthButton");
    datePicker.prevMonthButton = document.getElementById(datePicker.id + "PrevMonthButton");
    datePicker.nextYearButton = document.getElementById(datePicker.id + "NextYearButton");
    datePicker.prevYearButton = document.getElementById(datePicker.id + "PrevYearButton");
    datePicker.nextMonthButton.datePicker = datePicker.prevMonthButton.datePicker = datePicker.nextYearButton.datePicker = datePicker.prevYearButton.datePicker = datePicker;
    datePicker.monthCell = document.getElementById(datePicker.id + "MonthCell");
    datePicker.yearCell = document.getElementById(datePicker.id + "YearCell");
    datePicker.innerContainer = document.getElementById(datePicker.id + "InnerContainer");

    datePicker.onclick = function () {
        this.jsObject.options.parametersPanel.dateTimeButtonWasClicked = true;
    }

    datePicker.show = function (ownerValue, ownerControl) {
        this.ownerValue = ownerValue;
        this.ownerControl = ownerControl;
        this.dateValue = { "year": ownerValue.year, "month": ownerValue.month, "day": ownerValue.day };
        this.dateSelectedValue = { "year": ownerValue.year, "month": ownerValue.month, "day": ownerValue.day };
        this.fillCalendar();
        this.style.display = "";
    }

    datePicker.hide = function () {
        this.style.display = "none";
    }

    datePicker.nextMonth = function () {
        this.dateValue.month++;
        if (this.dateValue.month == 13) { this.dateValue.month = 1; this.dateValue.year++ }
        this.fillCalendar();
    };

    datePicker.prevMonth = function () {
        this.dateValue.month--;
        if (this.dateValue.month == 0) { this.dateValue.month = 12; this.dateValue.year-- }
        this.fillCalendar();
    };

    datePicker.nextYear = function () {
        this.dateValue.year++;
        this.fillCalendar();
    };

    datePicker.prevYear = function () {
        this.dateValue.year--;
        this.fillCalendar();
    };

    datePicker.fillCalendar = function () {
        countDaysInMonth = this.getCountDaysOfMonth();
        firstDay = this.getDayOfWeek();
        nowDate = new Date();
        this.monthCell.innerHTML = this.monthesNames[this.dateValue.month - 1];
        this.yearCell.innerHTML = this.dateValue.year;

        //Clear
        while (this.innerContainer.childNodes[0]) {
            this.innerContainer.removeChild(this.innerContainer.childNodes[0]);
        }

        table = document.createElement("Table");
        table.cellPadding = 0;
        table.cellSpacing = 0;
        tableBody = document.createElement("Tbody");
        table.appendChild(tableBody);
        row = document.createElement("Tr");
        tableBody.appendChild(row);

        //Add Items To Days Container
        for (i = 0; i < 42; i++) {
            row.appendChild(this.cellDay(i - (firstDay - 1) + 1, nowDate, firstDay, countDaysInMonth));
            if ((i + 1) % 7 == 0) {
                row = document.createElement("Tr");
                tableBody.appendChild(row);
            }
        }

        this.innerContainer.appendChild(table);
    }

    datePicker.cellDay = function (numDay, nowDate, firstDay, countDaysInMonth) {
        cellDay = document.createElement("Td");
        cellDay.numDay = numDay
        cellDay.style.width = "22px";
        cellDay.style.height = "22px";
        cellDay.style.textAlign = "center";
        cellDay.style.verticalAlign = "middle";
        cellDay.datePicker = this;
        cellDay.fixedClassName = null;

        div = document.createElement("Div");
        div.style.width = "22px";
        cellDay.appendChild(div);

        if (!((i < firstDay - 1) || (i - (firstDay - 1) > countDaysInMonth - 1))) {
            div.innerHTML = cellDay.numDay;
            cellDay.fixedClassName =
                (cellDay.numDay == nowDate.getDate() && this.dateValue.year == nowDate.getFullYear() && this.dateValue.month == nowDate.getMonth() + 1)
                    ? "stiCellDayNow"
                    : ((cellDay.numDay == this.dateSelectedValue.day && this.dateValue.year == this.dateSelectedValue.year && this.dateValue.month == this.dateSelectedValue.month)
                        ? "stiCellDaySelected"
                        : null);
            cellDay.className = cellDay.fixedClassName;

            cellDay.onmouseover = function () {
                this.className = "stiCellDayOver";
            }

            cellDay.onmouseout = function () {
                this.className = this.fixedClassName;
            }

            cellDay.onclick = function () {
                this.datePicker.ownerValue.year = this.datePicker.dateValue.year;
                this.datePicker.ownerValue.month = this.datePicker.dateValue.month;
                this.datePicker.ownerValue.day = this.numDay;
                this.datePicker.ownerControl.value =
                    this.datePicker.jsObject.dateTimeObjectToString(this.datePicker.ownerValue, this.datePicker.ownerControl.parameter.params.dateTimeType);
                this.datePicker.hide();
            }
        }

        return cellDay;
    }

    datePicker.getDayOfWeek = function () {
        result = new Date(this.dateValue.year, this.dateValue.month - 1, 1).getDay();
        if (result == 0) result = 7;
        return result;
    }

    datePicker.getCountDaysOfMonth = function () {
        var countDaysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
        var count = countDaysInMonth[this.dateValue.month - 1];

        if ((this.dateValue.month - 1) == 1)
            if (this.dateValue.year % 4 == 0 && (this.dateValue.year % 100 != 0 || this.dateValue.year % 400 == 0))
                count = 29;
            else
                count = 28;
        return count;
    }
}