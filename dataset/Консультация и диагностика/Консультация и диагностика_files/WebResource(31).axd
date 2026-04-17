.stiForm {
	overflow : visible;
	position: absolute;
	cursor: default;
	width: 360px;
	z-index: 7;
	color: Black;
}

.stiForm table,
.stiForm td {
	margin-top: 0;
}

.stiForm input[type="radio"],
.stiForm input[type="checkbox"] {
	margin: 0 2px 0 2px;
	border-top-width: 0px;
	border-left-width: 0px;
	border-right-width: 0px;
	border-bottom-width: 0px;
}

.stiFormDisabledPanel {
	position: absolute;
	right: 0px;
    bottom: 0px;
    left: 0px;
    top: 0px;
	filter: alpha(Opacity=20);
    opacity: 0.2;
    -moz-opacity: 0.2;
    -khtml-opacity: 0.2;
    background: white;	
}

.stiForm td,
.stiForm table {
	border: 0px;
	padding: 0px;
}

.stiCloseButton {
	background: url('[RemoveItem.gif]');
	width: 22px;
	height: 22px;
}

.stiCloseButtonOver {
	background: url('[HoverRemoveItem.gif]');
	width: 22px;
	height: 22px;
}

.stiExportTextBoxes {
    font-size: 11px;
    height: 20px;
    border: 1px solid Silver;
    margin: 0;
    padding: 0;
    margin-bottom: 0;
}

.stiExportDropDownLists {
    line-height: 22px;
    font-size: 12px;
    height: 22px;
}

.stiDisabledExportControl {
	color: Silver;
}

.stiEnabledExportControl {
	color: Black;
}