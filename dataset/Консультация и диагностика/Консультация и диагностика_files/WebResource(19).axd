
StiMvcViewer.prototype.createParameter = function (params) {
    parameter = document.createElement("Table");
    parameter.cellPadding = 0;
    parameter.cellSpacing = 0;
    tbody = document.createElement("TBODY");
    parameter.appendChild(tbody);
    row = document.createElement("Tr");
    tbody.appendChild(row);

    this.options.parameters[params.name] = parameter;
    parameter.params = params;
    parameter.controls = {};
    parameter.jsObject = this;
    parameter.params.isNull = false;
    parameter.menu = null;

    //menuCell
    row.appendChild(this.cellForMenu(parameter));
    //boolCheckBox
    if (parameter.params.type == "Bool" && (parameter.params.basicType == "Value" || parameter.params.basicType == "NullableValue"))
        row.appendChild(this.cellBoolCheckBox(parameter));
    //labelFrom
    if (parameter.params.basicType == "Range") row.appendChild(this.cellLabelFrom(parameter));
    //firstTextBox
    if (parameter.params.type != "Bool" || parameter.params.basicType == "List") row.appendChild(this.cellFirstTextBox(parameter));
    //firstDateTimeButton
    if (parameter.params.type == "DateTime" && parameter.params.allowUserValues && parameter.params.basicType != "List")
        row.appendChild(this.cellFirstDateTimeButton(parameter));
    //firstGuidButton
    if (parameter.params.type == "Guid" && parameter.params.allowUserValues && parameter.params.basicType != "List") row.appendChild(this.cellFirstGuidButton(parameter));
    //labelTo
    if (parameter.params.basicType == "Range") row.appendChild(this.cellLabelTo(parameter));
    //secondTextBox
    if (parameter.params.basicType == "Range") row.appendChild(this.cellSecondTextBox(parameter));
    //secondDateTimeButton
    if (parameter.params.basicType == "Range" && parameter.params.type == "DateTime" && parameter.params.allowUserValues) row.appendChild(this.cellSecondDateTimeButton(parameter));
    //secondGuidButton
    if (parameter.params.basicType == "Range" && parameter.params.type == "Guid" && parameter.params.allowUserValues) row.appendChild(this.cellSecondGuidButton(parameter));
    //dropDownButton
    if (parameter.params.items != null || (parameter.params.basicType == "List" && parameter.params.allowUserValues)) row.appendChild(this.cellDropDownButton(parameter));
    //nullableCheckBox
    if (parameter.params.basicType == "NullableValue" && parameter.params.allowUserValues) row.appendChild(this.cellNullableCheckBox(parameter));
    //nullableText
    if (parameter.params.basicType == "NullableValue" && parameter.params.allowUserValues) row.appendChild(this.cellNullableText(parameter));

    parameter.setEnabledState = function (state) {
        this.params.isNull = !state;
        for (var controlName in this.controls) { this.controls[controlName].setEnabledState(state); }
    }

    parameter.changeVisibleStateMenu = function (state) {
        if (state) {
            var menu = null;
            if (this.jsObject.options.parametersPanel.currentOpeningParameter != null)
                this.jsObject.options.parametersPanel.currentOpeningParameter.changeVisibleStateMenu(false);
            this.jsObject.options.parametersPanel.currentOpeningParameter = this;
            switch (this.params.basicType) {
                case "Value":
                case "NullableValue":
                    {
                        menu = this.jsObject.parameterMenuForValue(this);
                        break;
                    }
                case "Range":
                    {
                        menu = this.jsObject.parameterMenuForRange(this);
                        break;
                    }
                case "List":
                    {
                        if (this.params.allowUserValues) menu = this.jsObject.parameterMenuForEditList(this)
                        else menu = this.jsObject.parameterMenuForNotEditList(this);
                        break;
                    }
            }
            if (menu != null) { this.menuCell.appendChild(menu); this.menu = menu; }
        }
        else {
            if (this.menu != null) {
                if (this.params.allowUserValues && this.params.basicType == "List") this.menu.updateItems();
                this.menuCell.removeChild(this.menu);
            }
            this.jsObject.options.parametersPanel.currentOpeningParameter = null;
            this.menu = null;
        }
    }

    parameter.getStringDateTime = function (object) {
        return object.month + "/" + object.day + "/" + object.year + " " + Math.abs(object.hours - 12) + ":" + object.minutes + ":" + object.seconds + " " + (object.hours < 12 ? "AM" : "PM");
    }

    parameter.getValue = function () {
        value = null;
        if (parameter.params.isNull) return null;

        if (parameter.params.basicType == "Value" || parameter.params.basicType == "NullableValue") {
            if (parameter.params.type == "Bool") { return parameter.controls.boolCheckBox.checked; }
            if (parameter.params.type == "DateTime") { return this.getStringDateTime(parameter.params.key); }
            value = parameter.params.allowUserValues ? parameter.controls.firstTextBox.value : parameter.params.key;
        }

        if (parameter.params.basicType == "Range") {
            value = {};
            value.from = (parameter.params.type == "DateTime") ? this.getStringDateTime(parameter.params.key) : parameter.controls.firstTextBox.value;
            value.to = (parameter.params.type == "DateTime") ? this.getStringDateTime(parameter.params.keyTo) : parameter.controls.secondTextBox.value;
        }

        if (parameter.params.basicType == "List") {
            value = []
            if (parameter.params.allowUserValues)
                for (var index in parameter.params.items) value[index] =
                    (parameter.params.type == "DateTime")
                        ? this.getStringDateTime(parameter.params.items[index].key)
                        : parameter.params.items[index].key;
            else {
                num = 0;
                for (var index in parameter.params.items)
                    if (parameter.params.items[index].isChecked) {
                        value[num] = (parameter.params.type == "DateTime")
                            ? this.getStringDateTime(parameter.params.items[index].key)
                            : parameter.params.items[index].key;
                        num++;
                    }
            }
        }

        return value;
    };

    return parameter;
}

//menuCell
StiMvcViewer.prototype.cellForMenu = function (parameter) {
    cell = document.createElement("Td");
    parameter.menuCell = cell;

    return cell;
}

//boolCheckBox
StiMvcViewer.prototype.cellBoolCheckBox = function (parameter) {
    cell = document.createElement("Td");
    cell.style.height = "28px";
    cell.style.padding = "0px 1px 0 1px";

    checkBox = this.parameterCheckBox(parameter);
    parameter.controls.boolCheckBox = checkBox;
    checkBox.checked = (parameter.params.value == "true" || parameter.params.value == "True");
    checkBox.setEnabledState(parameter.params.allowUserValues);
    cell.appendChild(checkBox);

    return cell;
}

//labelFrom
StiMvcViewer.prototype.cellLabelFrom = function (parameter) {
    cell = document.createElement("Td");
    cell.style.height = "28px";
    cell.style.padding = "0px 1px 0 1px";
    cell.innerHTML = "From";

    return cell;
}

//firstTextBox
StiMvcViewer.prototype.cellFirstTextBox = function (parameter) {
    cell = document.createElement("Td");
    cell.style.height = "28px";
    cell.style.padding = "0px 1px 0 1px";

    textBox = this.parameterTextBox(parameter);
    cell.appendChild(textBox);
    parameter.controls.firstTextBox = textBox;
    textBox.setReadOnlyState(parameter.params.type == "DateTime" || parameter.params.basicType == "List" || !parameter.params.allowUserValues)

    //Value
    if (parameter.params.basicType == "Value" || parameter.params.basicType == "NullableValue") {
        textBox.value = 
            (parameter.params.type == "DateTime" || parameter.params.type == "TimeSpan")
            ? this.getStringKey(parameter.params.key, parameter) 
            : parameter.params.value;
    }

    //Range
    if (parameter.params.basicType == "Range") {
        textBox.value = this.getStringKey(parameter.params.key, parameter);
    }

    //List
    if (parameter.params.basicType == "List") {
        for (var index in parameter.params.items) {
            parameter.params.items[index].isChecked = true;
            if (textBox.value != "") textBox.value += ";";
            if (parameter.params.allowUserValues)
                textBox.value += this.getStringKey(parameter.params.items[index].key, parameter);
            else
                textBox.value += parameter.params.items[index].value != "" ? parameter.params.items[index].value : this.getStringKey(parameter.params.items[index].key, parameter);
        }
    }

    return cell;
}

//firstDateTimeButton
StiMvcViewer.prototype.cellFirstDateTimeButton = function (parameter) {
    cell = document.createElement("Td");
    cell.style.height = "28px";
    cell.style.padding = "0px 1px 0 1px";
    dateTimeButton = this.parameterButton("DateTimeButton", parameter);
    parameter.controls.firstDateTimeButton = dateTimeButton;
    cell.appendChild(dateTimeButton);

    dateTimeButton.onclick = function () {
        if (!this.isDisable) {
            this.parameter.jsObject.options.parametersPanel.dateTimeButtonWasClicked = true;
            this.parentElement.appendChild(this.parameter.jsObject.options.datePicker);
            this.parameter.jsObject.options.datePicker.show(this.parameter.params.key, this.parameter.controls.firstTextBox);
        }
    }

    return cell;
}

//firstGuidButton
StiMvcViewer.prototype.cellFirstGuidButton = function (parameter) {
    cell = document.createElement("Td");
    cell.style.height = "28px";
    cell.style.padding = "0px 1px 0 1px";
    guidButton = this.parameterButton("GuidButton", parameter);
    parameter.controls.firstGuidButton = guidButton;
    cell.appendChild(guidButton);

    guidButton.onclick = function () { if (!this.isDisable) this.parameter.controls.firstTextBox.value = this.parameter.jsObject.newGuid(); }

    return cell;
}

//labelTo
StiMvcViewer.prototype.cellLabelTo = function (parameter) {
    cell = document.createElement("Td");
    cell.style.height = "28px";
    cell.style.padding = "0px 1px 0 1px";
    cell.innerHTML = "To";

    return cell;
}

//secondTextBox
StiMvcViewer.prototype.cellSecondTextBox = function (parameter) {
    cell = document.createElement("Td");
    cell.style.height = "28px";
    cell.style.padding = "0px 1px 0 1px";

    textBox = this.parameterTextBox(parameter);
    cell.appendChild(textBox);
    parameter.controls.secondTextBox = textBox;
    textBox.setReadOnlyState(parameter.params.type == "DateTime" || !parameter.params.allowUserValues);
    textBox.value = this.getStringKey(parameter.params.keyTo, parameter);

    return cell;
}

//secondDateTimeButton
StiMvcViewer.prototype.cellSecondDateTimeButton = function (parameter) {
    cell = document.createElement("Td");
    cell.style.height = "28px";
    cell.style.padding = "0px 1px 0 1px";
    dateTimeButton = this.parameterButton("DateTimeButton", parameter);
    parameter.controls.secondDateTimeButton = dateTimeButton;
    cell.appendChild(dateTimeButton);

    dateTimeButton.onclick = function () {
        if (!this.isDisable) {
            this.parameter.jsObject.options.parametersPanel.dateTimeButtonWasClicked = true;
            this.parentElement.appendChild(this.parameter.jsObject.options.datePicker);
            this.parameter.jsObject.options.datePicker.show(this.parameter.params.keyTo, this.parameter.controls.secondTextBox);
        }
    }

    return cell;
}

//secondGuidButton
StiMvcViewer.prototype.cellSecondGuidButton = function (parameter) {
    cell = document.createElement("Td");
    cell.style.height = "28px";
    cell.style.padding = "0px 1px 0 1px";
    guidButton = this.parameterButton("GuidButton", parameter);
    parameter.controls.secondGuidButton = guidButton;
    cell.appendChild(guidButton);

    guidButton.onclick = function () { if (!this.isDisable) this.parameter.controls.secondTextBox.value = this.parameter.jsObject.newGuid(); }

    return cell;
}

//dropDownButton
StiMvcViewer.prototype.cellDropDownButton = function (parameter) {
    cell = document.createElement("Td");
    cell.style.height = "28px";
    cell.style.padding = "0px 1px 0 1px";
    dropDownButton = this.parameterButton("DropDownButton", parameter);
    parameter.controls.dropDownButton = dropDownButton;
    cell.appendChild(dropDownButton);     
    
    dropDownButton.onclick = function () {
        if (!this.isDisable) {
            this.parameter.jsObject.options.parametersPanel.dropDownButtonWasClicked = true;
            this.parameter.changeVisibleStateMenu(this.parameter.menu == null);
        }
    }

    return cell;
}

//nullableCheckBox
StiMvcViewer.prototype.cellNullableCheckBox = function (parameter) {
    cell = document.createElement("Td");
    cell.style.height = "28px";
    cell.style.padding = "0px 1px 0 1px";

    checkBox = this.parameterCheckBox(parameter);
    cell.appendChild(checkBox);

    checkBox.onclick = function () { this.parameter.setEnabledState(!this.checked); }

    return cell;
}

//nullableText
StiMvcViewer.prototype.cellNullableText = function (parameter) {
    cell = document.createElement("Td");
    cell.style.height = "28px";
    cell.innerHTML = "Null";

    return cell;
}