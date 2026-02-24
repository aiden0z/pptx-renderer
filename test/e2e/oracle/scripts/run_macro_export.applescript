on run argv
    set argc to count of argv
    if argc is less than 3 then
        error "Usage: osascript run_macro_export.applescript <input-pptm> <macro-name> [macro-param ...] <output-pdf>"
    end if

    set inPptm to POSIX file (item 1 of argv)
    set macroName to item 2 of argv
    set outPdf to POSIX file (item argc of argv)

    set macroParams to {}
    if argc is greater than 3 then
        set macroParams to items 3 thru (argc - 1) of argv
    end if

    tell application "Microsoft PowerPoint"
        open inPptm
        run VB macro macro name macroName list of parameters macroParams
        save active presentation in outPdf as save as PDF
        close active presentation saving no
    end tell
end run
