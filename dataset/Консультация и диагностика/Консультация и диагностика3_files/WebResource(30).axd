/* --- Styles for ToolBar & ToolBarButtons --- */

.stiToolbarLeft {
	background: url('[ToolbarBackgroundLeft.gif]') no-repeat;
}

.stiToolbarMiddle {
	background: url('[ToolbarBackgroundMiddle.gif]') repeat-x;
}

.stiToolbarRight {
	background: url('[ToolbarBackgroundRight.gif]') no-repeat;
}

.stiToolbarSeparator {
	background: url('[ToolBarSeparator.gif]') repeat-y;
}

/* ------ Button ------ */

.stiLeftHalfButton,
.stiRightHalfButton {
    width: 3px;
    height: 24px;
}

.stiMiddleHalfButton {
    text-align: center;
    height: 24px;
    font-size: 13px;
    border: 0;
    padding: 0;
}

div.stiHover .stiLeftHalfButton {
    width: 3px;
    height: 24px;
    background: url('[ButtonSelectorLeft.gif]') no-repeat;
}

div.stiHover .stiMiddleHalfButton {
    text-align: center;
    height: 24px;
    vertical-align: middle;
    background: url('[ButtonSelectorMiddle.gif]') repeat-x;
}

div.stiHover .stiRightHalfButton {
    width: 3px;
    height: 24px;
    background: url('[ButtonSelectorRight.gif]') no-repeat;
}

div.stiSelected .stiLeftHalfButton {
    width: 3px;
    height: 24px;
    background: url('[ButtonSelectorLeftPressed.gif]') no-repeat;
}

div.stiSelected .stiMiddleHalfButton {
    text-align: center;
    vertical-align: middle;
    background: url('[ButtonSelectorMiddlePressed.gif]') repeat-x;
}

div.stiSelected .stiRightHalfButton {
    width: 3px;
    height: 24px;
    background: url('[ButtonSelectorRightPressed.gif]') no-repeat;
}

div.stiFormButton .stiLeftHalfButton {
    width: 3px;
    height: 24px;
    background: url('[LeftHalfPanelButton.gif]') no-repeat;
}

div.stiFormButton .stiMiddleHalfButton {
    text-align: center;
    vertical-align: middle;
    background: url('[MiddleHalfPanelButton.gif]') repeat-x;
}

div.stiFormButton .stiRightHalfButton {
    width: 3px;
    height: 24px;
    background: url('[RightHalfPanelButton.gif]') no-repeat;
}