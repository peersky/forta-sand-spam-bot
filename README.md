# Sandbox Spam Agent

## Description

This agent detects transactions that send spam tokens to accounts that hold real SAND

## Supported Chains

- Ethereum
- Polygon

## Alerts

- USER-SPAMMED
  - Fired if user who received a SPAM token has real SAND in his account

## Labels

- SPAMMER
  - Labeled if number of transfers from an address with SPAM behaviour goes beyond 10
  - Confidence is calculated as sigmoid function [0...1] range; normalized against 100.

## Test Data

The agent behaviour can be verified with the following transactions:

- 0x4e64520bcfc14367b6f485a29741245f082f275acca9b441e3ad6c6eec383b07
