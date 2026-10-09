const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const Worker = require('./models/Worker');
const User = require('./models/User');
const Salary = require('./models/Salary');
const SalaryHistory = require('./models/SalaryHistory');
const Attendance = require('./models/Attendance');
const Overtime = require('./models/Overtime');

async function seedAllSalaries() {
  console.log('\n============================================================');
  console.log('       SMARTOPS SEED SALARY & ATTENDANCE DATA FOR TEACHER   ');
  console.log('============================================================\n');

  const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/smartops';
  console.log(`[SEED] Connecting to MongoDB: ${mongoUri}`);
  await mongoose.connect(mongoUri);

  // 1. Remove orphaned or invalid salaries where worker is undefined/null
  const deletedOrphans = await Salary.deleteMany({
    $or: [{ worker: null }, { worker: { $exists: false } }]
  });
  console.log(`[SEED] Cleaned up ${deletedOrphans.deletedCount} orphaned salary records.`);

  // 2. Fetch all workers
  const workers = await Worker.find({});
  console.log(`[SEED] Found ${workers.length} workers to seed salary data for.\n`);

  if (workers.length === 0) {
    console.log('No workers found. Please create at least one worker first.');
    await mongoose.disconnect();
    return;
  }

  // Define realistic variations for each worker so numbers look natural
  const variations = [
    { presentPct: 0.90, absentDays: 1, leaveDays: 2, halfDays: 1, lateCount: 2, otDays: 2 },
    { presentPct: 0.94, absentDays: 0, leaveDays: 1, halfDays: 0, lateCount: 1, otDays: 1 },
    { presentPct: 0.88, absentDays: 2, leaveDays: 2, halfDays: 1, lateCount: 3, otDays: 0 },
    { presentPct: 0.96, absentDays: 0, leaveDays: 1, halfDays: 0, lateCount: 0, otDays: 3 },
    { presentPct: 0.92, absentDays: 1, leaveDays: 1, halfDays: 1, lateCount: 2, otDays: 1 },
    { presentPct: 0.85, absentDays: 2, leaveDays: 3, halfDays: 0, lateCount: 4, otDays: 0 }
  ];

  const monthsToSeed = [
    { name: 'August 2026', totalDays: 31, year: 2026, monthIndex: 7, status: 'Paid', payDate: new Date('2026-08-31') },
    { name: 'September 2026', totalDays: 30, year: 2026, monthIndex: 8, status: 'Paid', payDate: new Date('2026-09-08') },
    { name: 'July 2026', totalDays: 31, year: 2026, monthIndex: 6, status: 'Paid', payDate: new Date('2026-07-31') }
  ];

  let totalSalariesCreated = 0;
  let totalAttendanceCreated = 0;

  for (let i = 0; i < workers.length; i++) {
    const worker = workers[i];
    const profile = variations[i % variations.length];
    const monthlySalary = worker.salary && worker.salary >= 15000 ? worker.salary : 24000;

    // Ensure worker has a valid base salary in worker doc
    if (!worker.salary || worker.salary < 15000) {
      worker.salary = monthlySalary;
      await worker.save();
    }

    console.log(`[SEED] Seeding for Worker: "${worker.name}" (Base Salary: ₹${monthlySalary.toLocaleString('en-IN')})...`);

    for (const m of monthsToSeed) {
      const perDaySalary = Math.round((monthlySalary / m.totalDays) * 100) / 100;
      
      const absentDays = profile.absentDays;
      const leaveDays = profile.leaveDays;
      const halfDays = profile.halfDays;
      const lateCount = profile.lateCount;
      const otDays = profile.otDays;
      
      // Calculate present days so everything totals correctly
      const nonPresentDays = absentDays + leaveDays + halfDays;
      const presentDays = Math.max(1, m.totalDays - nonPresentDays);

      // Company policy rules
      const exemptedLeaveDays = Math.min(leaveDays, 3);
      const chargeableLeaveDays = Math.max(0, leaveDays - 3);
      const leaveDeduction = Math.round(chargeableLeaveDays * perDaySalary * 100) / 100;

      const absentDeduction = Math.round(absentDays * perDaySalary * 100) / 100;
      const halfDayDeduction = Math.round(halfDays * 0.5 * perDaySalary * 100) / 100;

      const excusedLateCount = Math.min(lateCount, 3);
      const chargeableLateCount = Math.max(0, lateCount - 3);
      const lateDeduction = Math.round(chargeableLateCount * 0.5 * perDaySalary * 100) / 100;

      const overtimePay = Math.round(otDays * 0.5 * perDaySalary * 100) / 100;

      const payableDays = presentDays + (halfDays * 0.5) + exemptedLeaveDays;
      const baseEarnedSalary = Math.round(payableDays * perDaySalary * 100) / 100;
      const totalDeductions = Math.round((absentDeduction + leaveDeduction + halfDayDeduction + lateDeduction) * 100) / 100;
      const finalSalary = Math.max(0, Math.round((baseEarnedSalary - lateDeduction + overtimePay) * 100) / 100);

      const slipId = `PAY-${m.year}${String(m.monthIndex + 1).padStart(2, '0')}-${String(i + 1).padStart(3, '0')}`;

      // 1. Upsert Salary record
      await Salary.findOneAndUpdate(
        { worker: worker._id, month: m.name },
        {
          worker: worker._id,
          user: worker.user || undefined,
          month: m.name,
          monthlySalary,
          baseSalary: monthlySalary,
          basicSalary: monthlySalary,
          totalDays: m.totalDays,
          totalDaysInMonth: m.totalDays,
          perDaySalary,
          presentDays,
          absentDays,
          excusedAbsentDays: absentDays,
          chargeableAbsentDays: absentDays,
          absentDeduction,
          leaveDays,
          exemptedLeaveDays,
          chargeableLeaveDays,
          leaveDeduction,
          halfDays,
          halfDayDeduction,
          otherDeduction: 0,
          payableDays,
          baseEarnedSalary,
          lateCount,
          excusedLateCount,
          chargeableLateCount,
          lateDeduction,
          overtimeDays: otDays,
          overtimePay,
          deductions: totalDeductions,
          finalSalary,
          amount: finalSalary,
          netSalary: finalSalary,
          status: m.status,
          paymentStatus: m.status,
          paymentDate: m.payDate,
          slipId,
          notes: `${m.name} Payroll verified & disbursed via Direct Bank Transfer (NEFT/IMPS).`
        },
        { upsert: true, new: true }
      );
      totalSalariesCreated++;

      // 2. Upsert SalaryHistory
      await SalaryHistory.findOneAndUpdate(
        { worker: worker._id, month: m.name },
        {
          worker: worker._id,
          month: m.name,
          monthlySalary,
          perDaySalary,
          totalDays: m.totalDays,
          presentDays,
          absentDays,
          excusedAbsentDays: absentDays,
          chargeableAbsentDays: absentDays,
          absentDeduction,
          lateCount,
          excusedLateCount,
          chargeableLateCount,
          lateDeduction,
          overtimeDays: otDays,
          overtimePay,
          finalSalary,
          action: 'Disbursed',
          updatedBy: 'Supervisor Admin'
        },
        { upsert: true }
      );

      // 3. Seed daily attendance for August 2026 and September 2026 to make calculator dynamic
      const daysToGenerate = m.monthIndex === 8 ? 8 : m.totalDays; // Up to current date for Sep, all days for Aug
      const existingAtt = await Attendance.countDocuments({
        worker: worker._id,
        date: {
          $gte: new Date(m.year, m.monthIndex, 1),
          $lte: new Date(m.year, m.monthIndex, daysToGenerate, 23, 59, 59)
        }
      });

      if (existingAtt < 5) {
        for (let day = 1; day <= daysToGenerate; day++) {
          const attDate = new Date(m.year, m.monthIndex, day, 9, 0, 0);
          let status = 'Present';
          if (day === 5 && absentDays > 0) status = 'Absent';
          else if (day === 12 && leaveDays > 0) status = 'Leave';
          else if (day === 18 && halfDays > 0) status = 'Half Day';
          else if (day === 22 && otDays > 0) status = 'Overtime';
          else if (day === 25 && lateCount > 0) status = 'Late';

          await Attendance.create({
            worker: worker._id,
            user: worker.user || undefined,
            date: attDate,
            status,
            attendanceType: status,
            checkInTime: status === 'Late' ? '09:42 AM' : '08:55 AM',
            checkOutTime: status === 'Half Day' ? '01:30 PM' : '06:05 PM',
            workingHours: status === 'Half Day' ? 4 : (status === 'Overtime' ? 10 : 8),
            shift: 'General Shift',
            supervisorName: 'Supervisor Admin',
            employeeName: worker.name,
            employeeId: worker.employeeId || `EMP-${1000 + i}`,
            department: worker.department || 'Operations',
            site: worker.branch || 'Pune Head Office'
          });
          totalAttendanceCreated++;
        }
      }
    }
  }

  console.log('\n============================================================');
  console.log('✅ SALARY SEEDING COMPLETED SUCCESSFULLY!');
  console.log(`   - Total Workers Processed:    ${workers.length}`);
  console.log(`   - Total Salary Records Seeded: ${totalSalariesCreated} records across 3 months`);
  console.log(`   - Total Attendance Logs Added: ${totalAttendanceCreated} daily records`);
  console.log('============================================================\n');

  await mongoose.disconnect();
}

seedAllSalaries().catch(err => {
  console.error('Seeding error:', err);
  process.exit(1);
});
