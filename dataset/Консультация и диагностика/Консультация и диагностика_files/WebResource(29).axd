/* ----------------- Menu ---------------- */

.stiMenu {
	cursor: default;
}

.stiMenuParent {
	overflow : hidden;
	position: absolute;
}

.stiMenuShadow {
	position: absolute;
	background-color: Gray;
	z-index: 0;
	filter: alpha(Opacity=10);
    opacity: 0.1;
    -moz-opacity: 0.1;
    -khtml-opacity: 0.1;
}

.stiMenuCell {
	border: 0px;
	padding: 0px;
	white-space: nowrap;
}

/* ----------------- Menu Item ---------------- */

.stiMenuSpace table,
.stiMenuSpace td,
.stiMenuSeparator table,
.stiMenuSeparator td,
.stiMenuItem table,
.stiMenuItem td,
.stiMenuItemOver table,
.stiMenuItemOver td {
	border: 0px;
	padding: 0px;	
	cursor: default;
}

/* --------------- Menu Item Out -------------- */

.stiMenuItem div.stiLeftSpace {
	width: 1px;
	height: 22px;
	background : url('[VertMenuPreIcoBackground.gif]') repeat-y;
}

.stiMenuItem div.stiLeft {
    width: 3px;
    height: 22px;
    background: url('[VertMenuPreIcoBackground.gif]');
}

.stiMenuItem td.stiIcon img {
    vertical-align: top;
}

.stiMenuItem td.stiIcon {
    height: 22px;
    background: url('[VertMenuIcoBackground.gif]');
}

.stiMenuItem div.stiIcon {
	height: 16px;
	width: 20px;	
    background: url('[VertMenuIcoBackground.gif]');
}

.stiMenuItem div.stiLine {
    height: 22px;
    width: 3px;
    background: url('[VertMenuLineBackground.gif]') repeat-y;
}

.stiMenuItem td.stiText {
    height: 22px;
    vertical-align: middle;
    width: 100%;
    font-size: 12px;
    background: url('[VertMenuTextBackground.gif]');
    padding: 0 20px 0 3px;
}

.stiMenuItem div.stiHaveNotSubMenuSymbol {
    height: 22px;
    width: 6px;
    background: url('[VertMenuTextBackground.gif]');
}

.stiMenuItem div.stiHaveSubMenuSymbol {
    height: 22px;
    width: 6px;
    background: url('[VertMenuTextSubmenuBackground.gif]') no-repeat;
}

.stiMenuItem div.stiRightSpace {
    height: 22px;
    width: 1px;
    background: url('[VertMenuTextBackground.gif]') repeat-y;
}

.stiMenuItem div.stiRight {
    height: 22px;
    width: 3px;
    background: url('[VertMenuTextBackground.gif]');
}

/* --------------- Menu Item Over -------------- */

.stiMenuItemOver div.stiLeftSpace {
	width: 1px;
	height: 22px;
	background : url('[VertMenuPreIcoBackground.gif]') repeat-y;
}

.stiMenuItemOver div.stiLeft {
    width: 3px;
    height: 22px;
    background: url('[MenuSelectorLeft.gif]');
}

.stiMenuItemOver td.stiIcon img {
    vertical-align: top;
}

.stiMenuItemOver td.stiIcon {
    height: 22px;
    background: url('[MenuSelectorMiddle.gif]');
}

.stiMenuItemOver div.stiIcon {
	height: 16px;
	width: 20px;
}
.stiMenuItemOver div.stiLine {
    height: 22px;
    width: 3px;
    background: url('[MenuSelectorMiddle.gif]');
}

.stiMenuItemOver td.stiText {
    height: 22px;
    vertical-align: middle;
    width: 100%;
    font-size: 12px;
    background: url('[MenuSelectorMiddle.gif]');
    padding: 0 20px 0 3px;
}

.stiMenuItemOver div.stiHaveNotSubMenuSymbol {
    height: 22px;
    width: 6px;
    background: url('[MenuSelectorMiddle.gif]');
}

.stiMenuItemOver div.stiHaveSubMenuSymbol {
    height: 22px;
    width: 6px;
    background: url('[MenuSelectorMiddleSubmenu.gif]') no-repeat;
}

.stiMenuItemOver div.stiRightSpace {
    height: 22px;
    width: 1px;
    background: url('[VertMenuTextBackground.gif]') repeat-y;
}

.stiMenuItemOver div.stiRight {
    height: 22px;
    width: 3px;
    background: url('[MenuSelectorRight.gif]');
}

/* --- Styles for MenuSeparator and MenuSpace --- */

.stiMenuSeparator div.stiSeparatorLeft {
    height: 2px;
    width: 4px;
    background: url('[VertMenuPreIcoBackground.gif]') repeat-x;
}

.stiMenuSpace div.stiSpaceLeft {
    height: 1px;
    width: 4px;
    background: url('[VertMenuPreIcoBackground.gif]') repeat-x;
}

.stiMenuSeparator div.stiSeparatorIcon {
    height: 2px;
    width: 20px;
    background: url('[VertMenuIcoBackground.gif]') repeat-x;
}

.stiMenuSpace div.stiSpaceIcon {
    height: 1px;
    width: 20px;
    background: url('[VertMenuIcoBackground.gif]') repeat-x;
}

.stiMenuSeparator div.stiSeparatorLine {
    height: 2px;
    width: 3px;
    background: url('[VertMenuLineBackground.gif]') repeat-y;
}

.stiMenuSpace div.stiSpaceLine {
    height: 1px;
    width: 3px;
    background: url('[VertMenuLineBackground.gif]') repeat-y;
}

.stiMenuSeparator div.stiSeparatorLeftSpace,
.stiMenuSeparator div.stiSeparatorRightSpace {
    height: 2px;
    width: 3px;
    background: url('[VertMenuTextBackground.gif]') repeat-x;
}

.stiMenuSeparator div.stiSeparatorHorLine {
    height: 2px;
    width: 100%;
    background: url('[VertMenuSeparator.gif]') repeat-x;
}

.stiMenuSpace div.stiSpaceHorLine {
    height: 1px;
    width: 100%;
    background: url('[VertMenuTextBackground.gif]') repeat-x;
}

.stiMenuSpace,
.stiMenuSeparator {
    font-size: 0;
    line-height: 0px;
    border: 0;
    padding: 0;
}