
StiMvcViewer.prototype.InitializeParametersPanel = function (parametersPanel) {
    parametersPanel.jsObject = this;
    this.options.parametersPanel = parametersPanel;
    parametersPanel.container = document.getElementById(parametersPanel.id + "Container");
    parametersPanel.mainButtons = document.getElementById(parametersPanel.id + "MainButtons");
    parametersPanel.currentOpeningParameter = null;
    parametersPanel.dropDownButtonWasClicked = false;
    parametersPanel.dateTimeButtonWasClicked = false;

    parametersPanel.changeVisibleState = function (state) {
        this.style.display = state ? "" : "none";
        if (this.jsObject.options.buttons["Parameters"]) this.jsObject.options.buttons["Parameters"].setSelected(state);

        this.jsObject.options.reportPanel.style.marginTop = (this.jsObject.options.reportPanel.style.position == "relative" ? 0 : this.offsetHeight) + "px";
        this.jsObject.options.bookmarks.style.marginTop = ((this.jsObject.options.toolbar ? this.jsObject.options.toolbar.offsetHeight : 0) + this.offsetHeight) + "px";
    }

    parametersPanel.onclick = function () {
        this.jsObject.hideAllMenus();
    }

    parametersPanel.addParameters = function () {
        paramsProps = this.jsObject.copyObject(this.jsObject.options.paramsProps);
        countParameters = this.jsObject.getCountObjects(paramsProps);
        countColumns = (countParameters <= 5) ? 1 : this.jsObject.options.countColumnsParameters;
        countInColumn = parseInt(countParameters / countColumns);
        if (countInColumn * countColumns < countParameters) countInColumn++;

        table = document.createElement("Table");
        table.id = this.id + "Table";
        table.cellPadding = 0;
        table.cellSpacing = 0;
        table.style.border = "0px";
        tbody = document.createElement("TBODY");
        table.appendChild(tbody);
        this.container.appendChild(table);

        cellsVar = {};
        for (indexRow = 0; indexRow < countInColumn + 1; indexRow++) {
            row = document.createElement("TR");
            tbody.appendChild(row);

            for (indexColumn = 0; indexColumn < countColumns; indexColumn++) {
                cellForName = document.createElement("TD");
                cellForName.style.padding = "0px 10px 0px " + ((indexColumn > 0) ? "30px" : "0px");
                row.appendChild(cellForName);

                cellForControls = document.createElement("TD");
                cellForControls.style.padding = "0px";
                row.appendChild(cellForControls);

                cellsVar[indexRow + ";" + indexColumn + "name"] = cellForName;
                cellsVar[indexRow + ";" + indexColumn + "controls"] = cellForControls;
            }
        }

        indexColumn = 0;
        indexRow = 0;

        for (index = 0; index < countParameters; index++) {
            cellsVar[indexRow + ";" + indexColumn + "name"].style.whiteSpace = "nowrap";
            cellsVar[indexRow + ";" + indexColumn + "name"].innerHTML = paramsProps[index].alias;
            cellsVar[indexRow + ";" + indexColumn + "controls"].appendChild(this.jsObject.createParameter(paramsProps[index]));
            indexRow++;
            if (index == countParameters - 1) cellsVar[indexRow + ";" + indexColumn + "controls"].appendChild(this.mainButtons);
            if (indexRow == countInColumn) { indexRow = 0; indexColumn++; }
        }
    }

    parametersPanel.clearParameters = function () {
        while (this.container.childNodes[0]) {
            this.container.removeChild(this.container.childNodes[0]);
        }
    }

    parametersPanel.getParametersValues = function () {
        parametersValues = {};

        for (var name in this.jsObject.options.parameters) {
            parameter = this.jsObject.options.parameters[name];
            parametersValues[name] = parameter.getValue();
        }

        return parametersValues;
    }
}