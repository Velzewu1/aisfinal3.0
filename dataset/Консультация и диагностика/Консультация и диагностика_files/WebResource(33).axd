.stiParametersPanel {
	cursor: default;
	width: 100%;
	margin: 0 0 3px 0;
	font-size: 13px;
	position: relative;
	z-index: 2;
}

.stiParametersPanel table,
.stiParametersPanel td {
	border: 0px;
	padding: 0px;
}

.stiParametersPanel input[type="radio"],
.stiParametersPanel input[type="checkbox"] {
	margin: 0 2px 0 2px;
}

.stiInnerContainerParametersPanel {
	width: 100%;
	padding: 10px;
}

.stiParametersTextBoxes {
    font-size: 12px;
    height: 20px;
    border: 1px solid Silver;
    margin: 0px;
    padding: 0px;
    font-family: "Arial";
}

.stiParametersTextBoxesReadOnly {
    font-size: 12px;
    height: 20px;
    border: 1px solid Silver;
    margin: 0px;
    padding: 0px;
    font-family: "Arial";
	-moz-user-select: none;
    -khtml-user-select: none;
    -webkit-user-select: none;    
}

/* -------------------- Buttons -----------------*/
.stiDropDownButton {
	background: url('[DropDownButton.gif]');
}

.stiDropDownButtonOver {
	background: url('[DropDownButtonHover.gif]');
}

.stiDropDownButtonDisabled {
	background: url('[DisabledDropDownButton.gif]');
}

.stiDateTimeButton {
	background: url('[DateTimeButton.gif]');
}

.stiDateTimeButtonOver {
	background: url('[DateTimeButtonHover.gif]');
}

.stiDateTimeButtonDisabled {
	background: url('[DisabledDateTimeButton.gif]');
}

.stiGuidButton {
	background: url('[GuidButton.gif]');
}

.stiGuidButtonOver {
	background: url('[GuidButtonHover.gif]');
}

.stiGuidButtonDisabled {
	background: url('[DisabledGuidButton.gif]');
}

.stiRemoveItemButton {
	background: url('[RemoveItem.gif]');
}

.stiRemoveItemButtonOver {
	background: url('[HoverRemoveItem.gif]');
}

/* -------------------- Menu -----------------*/

.stiParametersMenu {
	position: absolute;
	z-index : 3;
	margin-top: 12px;
}

.stiParametersMenuScrollPanel {
	max-height: 240px;
	overflow-x: hidden;
	overflow-y: auto;
}

.stiParametersMenuInnerTable {
    background: url('[VertMenuTextBackground.gif]');
}

.stiParametersMenuShadow {
	position: absolute;
	background-color: Gray;
	filter: alpha(Opacity=10);
    opacity: 0.1;
    -moz-opacity: 0.1;
    -khtml-opacity: 0.1;
}

.stiParametersMenuSeparator {
    height: 2px;
    width: 100%;
    background: url('[VertMenuSeparator.gif]') repeat-x;
}

.stiParametersMenuItem td,
.stiParametersMenuItemOver td,
.stiParametersMenuItem table,
.stiParametersMenuItemOver table{
	border: 0px;
	padding: 0px;
}

.stiParametersMenuItem div.stiLeftHalf,
.stiParametersMenuItem div.stiRightHalf {
    width: 3px;
    height: 22px;
}

.stiParametersMenuItem td.stiMiddleHalf {
    height: 22px;
    vertical-align: middle;
    width: 100%;
    font-size: 12px;
    padding: 0 13px 0 0;
    white-space: nowrap;
    overflow: hidden;
}

.stiParametersMenuItemOver div.stiLeftHalf {
    width: 3px;
    height: 22px;
    background: url('[MenuSelectorLeft.gif]');
}

.stiParametersMenuItemOver div.stiRightHalf {
    width: 3px;
    height: 22px;
    background: url('[MenuSelectorRight.gif]');
}

.stiParametersMenuItemOver td.stiMiddleHalf {
    height: 22px;
    vertical-align: middle;
    width: 100%;
    font-size: 12px;
    background: url('[MenuSelectorMiddle.gif]');
    padding: 0 3px 0 0;
    white-space: nowrap;
    overflow: hidden;
}