# Budget System Guide

## Overview
The budget system tracks spending on purchases by matching budget rules against the **Project ID** field when you create purchases. Everything is dropdown-based for consistency.

## How It Works

### 1. Creating a Budget

When you create a budget, you choose **what it should track** from a dropdown:

#### **All Purchases**
- Tracks every purchase in the system (except items marked "Budget Exempt")
- Use this for organization-wide budgets
- Example: "2025 Total Spending Budget"

#### **Specific Project/Category** ⭐ Most Common
- Tracks purchases where the Project ID **exactly matches** what you select
- This is what you want for tracking categories like "9584 misc"
- Select from dropdown:
  - `9584 misc`
  - `Competition`
  - `Lab Supply`
  - `Mechanical Supply`
  - `Electrical Consumable`
  - etc.

#### **Subsystem**
- Tracks purchases for a specific subsystem (Drivetrain, Intake, etc.)
- Select from your configured subsystems

#### **Specific Build**
- Tracks purchases for a specific build/release
- Select from your existing builds (e.g., "Drivetrain-v2")

#### **Build Group**
- Tracks purchases where Project ID **contains** the subsystem name
- Select a subsystem name from dropdown

### 2. Creating Purchases

When you add a misc purchase, you select a **Project ID** from the dropdown:
- `9584 misc`
- `Competition`
- `Lab Supply`
- `Mechanical Supply`
- `Electrical Consumable`
- etc.

The budget system will automatically match this purchase to any budgets tracking that Project ID.

### 3. Budget Exempt

If you select **"Budget Exempt"** as the Project ID when creating a purchase, that purchase will NOT count toward ANY budget. Use this for purchases that shouldn't be tracked.

## Example: Tracking "9584 misc" Purchases

**Problem:** You want to track all miscellaneous purchases for team 9584.

**Solution:**
1. Go to Admin → Budgets Tab
2. Click "New Budget"
3. Fill in:
   - **Budget Name**: "Team 9584 Miscellaneous"
   - **What should this budget track?**: Select "Specific Project/Category"
   - **Project ID**: Select `9584 misc` from dropdown
   - **Budget Amount**: $5000 (or whatever your budget is)
   - **Start Date**: 1/1/2025
   - **End Date**: 12/31/2025 (optional)
   - **Category**: Select "Team 9584" (optional label)
4. Click "Save Budget"

Now, whenever you create a purchase with Project ID = "9584 misc", it will count toward this budget!

## Tips

- **Everything is dropdown-based** - no typing needed, ensures consistency
- **Project IDs must match exactly** - the dropdowns ensure this
- Pin budgets to your dashboard to see spending at a glance
- The "Category" field on budgets is just a label - it doesn't affect what gets tracked
- Rejected purchases don't count toward budgets

## Available Project IDs

Standard Project IDs available in the dropdown:
- `9584 misc` - Team 9584 miscellaneous items
- `Competition` - Competition-related purchases
- `Outreach + Fundraising` - Outreach and fundraising
- `Mechanical Supply` - Mechanical supplies
- `Mechanical Consumable` - Mechanical consumables
- `Electrical Supply` - Electrical supplies
- `Electrical Consumable` - Electrical consumables
- `Lab Supply` - Lab supplies
- `Lab Consumable` - Lab consumables
- `Software Supply` - Software supplies
- `Software Consumable` - Software consumables
- `Manufacturing Stock` - Manufacturing stock
- `Other` - Other purchases

You can also link purchases to specific builds which will appear in the build dropdown.
