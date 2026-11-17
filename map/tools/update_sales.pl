#!/usr/bin/perl
# macOS: converts data/sales_status.csv into data/sales_status.js (the file the map reads) — only when the CSV is newer.
# Same job as tools/update_sales.ps1 on Windows. Row checks are done by the map itself (staff screen: tap the logo 5 times).
use strict; use warnings; use File::Basename qw(dirname); use Cwd qw(abs_path);
my $root = abs_path(dirname(abs_path($0)) . '/..');
my ($csv, $js) = ("$root/data/sales_status.csv", "$root/data/sales_status.js");
exit 0 unless -f $csv;
if (-f $js && (stat $js)[9] >= (stat $csv)[9]) { print "sales_status.js is up to date\n"; exit 0 }
open(my $f, "<:raw", $csv) or die "cannot read $csv: $!"; local $/; my $t = <$f>; close $f; $t =~ s/^\xEF\xBB\xBF//;
my %esc = ("\"" => '\\"', "\\" => '\\\\', "\n" => '\\n', "\r" => '\\r', "\t" => '\\t', "\x{08}" => '\\b', "\x{0c}" => '\\f');
$t =~ s/(["\\\n\r\t\x08\x0c])/$esc{$1}/g; $t =~ s/([\x00-\x1f])/sprintf('\\u%04x', ord $1)/ge;
open(my $o, '>:raw', "$js.tmp") or die "cannot write $js: $!"; print $o "window.SALES_CSV = \"$t\";\n"; close $o;
rename("$js.tmp", $js) or die $!;
print "sales_status.js updated from sales_status.csv\n";
