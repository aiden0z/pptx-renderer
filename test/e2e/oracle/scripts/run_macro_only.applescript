on run argv
    set argc to count of argv
    if argc is less than 2 then
        error "Usage: osascript run_macro_only.applescript <input-pptm> <macro-name> [macro-param ...]"
    end if

    set inPptm to POSIX file (item 1 of argv)
    set macroName to item 2 of argv

    set macroParams to {}
    if argc is greater than 2 then
        set macroParams to items 3 thru argc of argv
    end if

    tell application "Microsoft PowerPoint"
        open inPptm
        run VB macro macro name macroName list of parameters macroParams
        close active presentation saving no
    end tell
end run
