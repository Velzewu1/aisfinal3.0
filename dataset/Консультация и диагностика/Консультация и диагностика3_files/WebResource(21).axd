
//Menu
StiMvcViewer.prototype.parameterMenu = function (parameter) {
    menuParent = document.createElement("Div");
    menuParent.className = "stiParametersMenu";
    menuParent.parameter = parameter;

    for (k = 0; k < 5; k++) {
        shadow = document.createElement("Div");
        shadow.className = "stiMenuShadow";
        shadow.style.zIndex = 0;
        menuParent.appendChild(shadow);
        shadow.style.right = -k + "px";
        shadow.style.bottom = -k + "px";
        shadow.style.left = k + "px";
        shadow.style.top = k + "px";
    }

    menuScrollPanel = document.createElement("Div");
    if (parameter.params.type != "DateTime") menuScrollPanel.className = "stiParametersMenuScrollPanel";
    menuParent.appendChild(menuScrollPanel);

    table = document.createElement("Table");
    table.style.width = (parameter.offsetWidth - 1) + "px";
    table.style.position = "relative";
    table.className = "stiParametersMenuInnerTable";
    table.style.zIndex = 1;
    menuScrollPanel.appendChild(table);
    menuScrollPanel.style.position = "relative";
    menuScrollPanel.style.border = "1px solid " + this.options.mvcViewer.getAttribute("BorderColor");
    table.cellPadding = 0;
    table.cellSpacing = 0;
    tbody = document.createElement("TBODY");
    table.appendChild(tbody);
    menuParent.innerTable = tbody;

    menuParent.onclick = function () {
        this.parameter.jsObject.options.parametersPanel.dropDownButtonWasClicked = true;
    }

    return menuParent;
}

//MenuItem
StiMvcViewer.prototype.parameterMenuItem = function (parameter) {
    menuItem = document.createElement("Div");
    menuItem.style.padding = "1px";
    menuItem.parameter = parameter;
    menuItem.className = "stiParametersMenuItem";

    table = document.createElement("Table");
    menuItem.appendChild(table);
    table.cellPadding = 0;
    table.cellSpacing = 0;
    table.style.border = "0px";
    tbody = document.createElement("TBODY");
    table.appendChild(tbody);
    row = document.createElement("TR");
    tbody.appendChild(row);

    menuItem.onmouseover = function () { this.className = "stiParametersMenuItemOver"; }
    menuItem.onmouseout = function () { this.className = "stiParametersMenuItem"; }

    cellLeft = document.createElement("TD");
    row.appendChild(cellLeft);
    leftDiv = document.createElement("DIV");
    leftDiv.className = "stiLeftHalf";
    cellLeft.appendChild(leftDiv);

    cellMiddle = document.createElement("TD");
    cellMiddle.className = "stiMiddleHalf";
    menuItem.innerContainer = cellMiddle;
    row.appendChild(cellMiddle);

    cellRight = document.createElement("TD");
    row.appendChild(cellRight);
    rightDiv = document.createElement("DIV");
    rightDiv.className = "stiRightHalf";
    cellRight.appendChild(rightDiv);

    return menuItem;
}

//MenuSeparator
StiMvcViewer.prototype.parameterMenuSeparator = function () {
    separator = document.createElement("Div");
    separator.className = "stiParametersMenuSeparator";

    return separator;
}

//Menu For Value
StiMvcViewer.prototype.parameterMenuForValue = function (parameter) {
    menuParent = this.parameterMenu(parameter);

    for (var index in parameter.params.items) {
        row = document.createElement("TR");
        menuParent.innerTable.appendChild(row);
        cell = document.createElement("TD");
        cell.style.border = "0px";
        cell.style.padding = "0px";
        row.appendChild(cell);

        menuItem = this.parameterMenuItem(parameter);
        cell.appendChild(menuItem);
        menuItem.parameter = parameter;
        menuItem.key = parameter.params.items[index].key;
        menuItem.value = parameter.params.items[index].value;
        menuItem.innerContainer.innerHTML =
            (menuItem.value != "" && parameter.params.type != "DateTime" && parameter.params.type != "TimeSpan" && parameter.params.type != "Bool")
                ? menuItem.value
                : this.getStringKey(menuItem.key, menuItem.parameter);

        menuItem.onclick = function () {
            this.parameter.params.key = this.key;
            if (this.parameter.params.type != "Bool")
                this.parameter.controls.firstTextBox.value =
                    (this.parameter.params.type == "DateTime" || this.parameter.params.type == "TimeSpan")
                        ? this.parameter.jsObject.getStringKey(this.key, this.parameter)
                        : (this.parameter.params.allowUserValues ? this.key : (this.value != "" ? this.value : this.key));
            else
                this.parameter.controls.boolCheckBox.checked = (this.key == "True" || this.key == "true");

            this.parameter.changeVisibleStateMenu(false);
        }
    }

    return menuParent;
}

//Menu For Range
StiMvcViewer.prototype.parameterMenuForRange = function (parameter) {
    menuParent = this.parameterMenu(parameter);

    for (var index in parameter.params.items) {
        row = document.createElement("TR");
        menuParent.innerTable.appendChild(row);
        cell = document.createElement("TD");
        cell.style.border = "0px";
        cell.style.padding = "0px";
        row.appendChild(cell);

        menuItem = this.parameterMenuItem(parameter);
        cell.appendChild(menuItem);
        menuItem.parameter = parameter;
        menuItem.value = parameter.params.items[index].value;
        menuItem.key = parameter.params.items[index].key;
        menuItem.keyTo = parameter.params.items[index].keyTo;
        menuItem.innerContainer.innerHTML = menuItem.value + " [" + this.getStringKey(menuItem.key, menuItem.parameter) +
            " - " + this.getStringKey(menuItem.keyTo, menuItem.parameter) + "]";

        menuItem.onclick = function () {
            this.parameter.params.key = this.key;
            this.parameter.params.keyTo = this.keyTo;            
            this.parameter.controls.firstTextBox.value = this.parameter.jsObject.getStringKey(this.key, this.parameter);
            this.parameter.controls.secondTextBox.value = this.parameter.jsObject.getStringKey(this.keyTo, this.parameter);
            this.parameter.changeVisibleStateMenu(false);
        }
    }

    return menuParent;
}

//Menu For ListNotEdit
StiMvcViewer.prototype.parameterMenuForNotEditList = function (parameter) {
    menuParent = this.parameterMenu(parameter);
    menuParent.menuItems = {};

    for (var index in parameter.params.items) {
        row = document.createElement("TR");
        menuParent.innerTable.appendChild(row);
        cell = document.createElement("TD");
        cell.style.border = "0px";
        cell.style.padding = "0px";
        row.appendChild(cell);

        menuItem = this.parameterMenuItem(parameter);
        cell.appendChild(menuItem);
        menuItem.parameter = parameter;
        menuItem.value = parameter.params.items[index].value;
        menuItem.key = parameter.params.items[index].key;
        menuParent.menuItems[index] = menuItem;

        innerTable = document.createElement("Table");
        menuItem.innerContainer.appendChild(innerTable);
        innerTableBody = document.createElement("Tbody");
        innerTable.appendChild(innerTableBody);
        innerRow = document.createElement("TR");
        innerTableBody.appendChild(innerRow);
        cellCheck = document.createElement("TD");
        innerRow.appendChild(cellCheck);

        checkBox = this.parameterCheckBox(parameter); ;
        cellCheck.appendChild(checkBox);
        checkBox.menuParent = menuParent;
        checkBox.checked = parameter.params.items[index].isChecked;
        menuItem.checkBox = checkBox;

        checkBox.onclick = function () {
            this.parameter.params.items = {};
            this.parameter.controls.firstTextBox.value = "";

            for (var index in this.menuParent.menuItems) {
                this.parameter.params.items[index] = {};
                this.parameter.params.items[index].key = this.menuParent.menuItems[index].key;
                this.parameter.params.items[index].value = this.menuParent.menuItems[index].value;
                this.parameter.params.items[index].isChecked = this.menuParent.menuItems[index].checkBox.checked;

                if (this.parameter.params.items[index].isChecked) {
                    if (this.parameter.controls.firstTextBox.value != "") this.parameter.controls.firstTextBox.value += ";";
                    this.parameter.controls.firstTextBox.value += this.menuParent.menuItems[index].value != "" ? this.menuParent.menuItems[index].value : this.parameter.jsObject.getStringKey(this.menuParent.menuItems[index].key, this.parameter);
                }
            }
        }

        cellText = document.createElement("TD");
        cellText.style.whiteSpace = "nowrap";
        innerRow.appendChild(cellText);        
        cellText.innerHTML = menuItem.value != "" ? menuItem.value : this.getStringKey(menuItem.key, menuItem.parameter);

        if (index == this.getCountObjects(parameter.params.items) - 1) {
            closeButton = this.parameterMenuItem(parameter);
            closeButton.innerContainer.innerHTML = this.options.parametersPanel.getAttribute("Word_Close");
            closeButton.onclick = function () { this.parameter.changeVisibleStateMenu(false); }
            cell.appendChild(this.parameterMenuSeparator());
            cell.appendChild(closeButton);
        }
    }

    return menuParent;
}

//Menu For ListEdit
StiMvcViewer.prototype.parameterMenuForEditList = function (parameter) {
    menuParent = this.parameterMenu(parameter);
    
    //New Item Method
    menuParent.newItem = function (item, parameter) {
        menuItem = parameter.jsObject.parameterMenuItem(parameter);
        menuItem.onmouseover = null;
        cell.appendChild(menuItem);
        menuItem.parameter = parameter;
        menuItem.value = item.value;
        menuItem.key = item.key;

        innerTable = document.createElement("Table");
        menuItem.innerContainer.appendChild(innerTable);
        innerTableBody = document.createElement("Tbody");
        innerTable.appendChild(innerTableBody);
        innerRow = document.createElement("TR");
        innerTableBody.appendChild(innerRow);

        //Text Box
        cellTextBox = document.createElement("TD");
        cellTextBox.style.padding = "0 1px 0 0";
        innerRow.appendChild(cellTextBox);
        textBox = parameter.jsObject.parameterTextBox(parameter);
        textBox.thisMenu = menuParent;
        cellTextBox.appendChild(textBox);
        menuItem.textBox = textBox;
        textBox.setReadOnlyState(parameter.params.type == "DateTime");
        textBox.value = parameter.jsObject.getStringKey(menuItem.key, menuItem.parameter);

        //DateTime Button
        if (parameter.params.type == "DateTime") {
            cellDateTimeButton = document.createElement("TD");
            cellDateTimeButton.style.padding = "0 1px 0 1px";
            innerRow.appendChild(cellDateTimeButton);
            dateTimeButton = parameter.jsObject.parameterButton("DateTimeButton", parameter);
            dateTimeButton.thisItem = menuItem;
            cellDateTimeButton.appendChild(dateTimeButton);

            dateTimeButton.onclick = function () {
                this.parameter.jsObject.options.parametersPanel.dateTimeButtonWasClicked = true;
                this.parentElement.appendChild(this.parameter.jsObject.options.datePicker);
                this.parameter.jsObject.options.datePicker.show(this.thisItem.key, this.thisItem.textBox);
            }
        }

        //Guid Button
        if (parameter.params.type == "Guid") {
            cellGuidButton = document.createElement("TD");
            cellGuidButton.style.padding = "0 1px 0 1px";
            innerRow.appendChild(cellGuidButton);
            guidButton = parameter.jsObject.parameterButton("GuidButton", parameter);
            guidButton.thisItem = menuItem;
            guidButton.thisMenu = menuParent;
            cellGuidButton.appendChild(guidButton);

            guidButton.onclick = function () {
                this.thisItem.textBox.value = this.parameter.jsObject.newGuid();
                this.thisMenu.updateItems();
            }
        }

        //Remove Button
        cellRemoveButton = document.createElement("TD");
        cellRemoveButton.style.padding = "0 1px 0 1px";
        innerRow.appendChild(cellRemoveButton);
        removeButton = parameter.jsObject.parameterButton("RemoveItemButton", parameter);
        removeButton.itemsContainer = this.itemsContainer;
        removeButton.thisItem = menuItem;
        removeButton.thisMenu = menuParent;
        cellRemoveButton.appendChild(removeButton);
        removeButton.onclick = function () {
            this.itemsContainer.removeChild(this.thisItem);
            this.thisMenu.updateItems();
        }

        return menuItem;
    }

    //Update Items
    menuParent.updateItems = function () {
        this.parameter.params.items = {};
        this.parameter.controls.firstTextBox.value = "";
        for (index = 0; index < this.itemsContainer.childNodes.length; index++) {
            itemMenu = this.itemsContainer.childNodes[index];
            this.parameter.params.items[index] = {};
            this.parameter.params.items[index].key =
                (this.parameter.params.type == "DateTime" || this.parameter.params.type == "TimeSpan")
                ? itemMenu.key
                : itemMenu.textBox.value;
            this.parameter.params.items[index].value = itemMenu.value;
            if (this.parameter.controls.firstTextBox.value != "") this.parameter.controls.firstTextBox.value += ";";
            this.parameter.controls.firstTextBox.value += this.parameter.jsObject.getStringKey(this.parameter.params.items[index].key, this.parameter);
        }
    }

    rowUp = document.createElement("TR");
    menuParent.innerTable.appendChild(rowUp);
    cellUp = document.createElement("TD");
    rowUp.appendChild(cellUp);

    //New Item Button
    newItemButton = this.parameterMenuItem(parameter);
    cellUp.appendChild(newItemButton);
    newItemButton.innerContainer.innerHTML = this.options.parametersPanel.getAttribute("Word_NewItem");
    newItemButton.thisMenu = menuParent;
    newItemButton.onclick = function () {
        item = {};
        if (this.parameter.params.type == "DateTime") {
            item.key = this.parameter.jsObject.getNowDateTimeObject();
            item.value = this.parameter.jsObject.dateTimeObjectToString(item.key, this.parameter);
        }
        else {
            if (this.parameter.params.type == "Bool") {
                item.key = "false";
                item.value = "false";
            }
            else {
                item.key = "";
                item.value = "";
            }
        }
        newItem = this.thisMenu.newItem(item, this.parameter);
        this.thisMenu.itemsContainer.appendChild(newItem);
        if ("textBox" in newItem) newItem.textBox.focus();
        this.thisMenu.updateItems();
    }

    //Add Items
    rowItems = document.createElement("TR");
    menuParent.innerTable.appendChild(rowItems);
    cellItems = document.createElement("TD");
    rowItems.appendChild(cellItems);
    menuParent.itemsContainer = cellItems;

    for (var index in parameter.params.items) {
        cellItems.appendChild(menuParent.newItem(parameter.params.items[index], parameter));
    }

    rowDown = document.createElement("TR");
    menuParent.innerTable.appendChild(rowDown);
    cellDown = document.createElement("TD");
    rowDown.appendChild(cellDown);

    //Remove All Button
    removeAllButton = this.parameterMenuItem(parameter);
    cellDown.appendChild(removeAllButton);
    removeAllButton.innerContainer.innerHTML = this.options.parametersPanel.getAttribute("Word_RemoveAll"); ;
    removeAllButton.thisMenu = menuParent;
    removeAllButton.onclick = function () {
        while (this.thisMenu.itemsContainer.childNodes[0]) {
            this.thisMenu.itemsContainer.removeChild(this.thisMenu.itemsContainer.childNodes[0]);
        }
        this.thisMenu.updateItems();
    }

    //Close Button
    cellDown.appendChild(this.parameterMenuSeparator());
    closeButton = this.parameterMenuItem(parameter);
    cellDown.appendChild(closeButton);
    closeButton.innerContainer.innerHTML = this.options.parametersPanel.getAttribute("Word_Close"); ;
    closeButton.onclick = function () { this.parameter.changeVisibleStateMenu(false); }

    return menuParent;
}