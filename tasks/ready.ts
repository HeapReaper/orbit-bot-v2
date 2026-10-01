import cron from "node-cron";

export default {
  name: "example-task",

  schedule: "* * * * *",

  execute() {
    console.log("Running example task every minute");
  },
};
